import { readFile, readdir, writeFile } from 'node:fs/promises'
import { delimiter as pathDelimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeSessionLog,
  normalizeSessionSnapshot,
  normalizeStdout,
  scrubRequestHeaders,
  type NormalizeContext,
} from '@deepseek-ai/dsh-session-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const scenarioDir = fileURLToPath(new URL('./expected/verified-control/', import.meta.url))
const configPath = fileURLToPath(new URL('../verified-control-snapshot.patch.yml', import.meta.url))
const verifiedBundlePatch = fileURLToPath(new URL('../../../../../../packages/bundle/verified-control/cordis.patch.yml', import.meta.url))
const binScript = fileURLToPath(new URL('../../../../../../packages/test-support/loader-smoke/tests/fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

interface JsonObject {
  [key: string]: unknown
}

function parseJsonl(content: string): JsonObject[] {
  return content.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

function contextFromLog(content: string): NormalizeContext {
  const header = parseJsonl(content)[0]
  return {
    sessionIds: typeof header?.id === 'string' ? [header.id] : [],
    cwd: typeof header?.cwd === 'string' ? header.cwd : '\0no-cwd\0',
  }
}

function normalizeControlTimes(content: string): string {
  return content.replace(/("(?:createdAt|updatedAt|clearedAt|startedAt|observedAt|validUntil)":)\d+/g, '$10')
}

function normalizeHeadlessStream(rawStdout: string, cwd: string): string {
  const records = parseJsonl(rawStdout)
  if (records.length === 0) throw new Error('verified-control snapshot emitted no stream-json records')
  const final = records.at(-1)
  if (final?.type !== 'result') throw new Error('verified-control snapshot did not end with a result record')
  if (records.slice(0, -1).some(record => record.type !== 'session_event')) {
    throw new Error('verified-control snapshot emitted a non-event record before its result')
  }

  const sessionIds = [...new Set(records.flatMap(record => typeof record.sessionId === 'string' ? [record.sessionId] : []))]
  if (sessionIds.length !== 1) throw new Error(`verified-control snapshot streamed ${sessionIds.length} main session ids`)
  const context: NormalizeContext = { sessionIds, cwd }
  const events = records.slice(0, -1).map((record) => {
    if (record.event === null || typeof record.event !== 'object' || Array.isArray(record.event)) {
      throw new Error('verified-control snapshot emitted an invalid session event')
    }
    return record.event as JsonObject
  })
  const normalizedEvents = parseJsonl(scrubRequestHeaders(normalizeSessionLog(
    `${events.map(event => JSON.stringify(event)).join('\n')}\n`,
    context,
  )))
  const normalizedRecords = records.map((record, index) => index < normalizedEvents.length
    ? { ...record, event: normalizedEvents[index] }
    : record)
  return normalizeControlTimes(normalizeStdout(
    `${normalizedRecords.map(record => JSON.stringify(record)).join('\n')}\n`,
    context,
  ))
}

async function scenarioPrompt(): Promise<string> {
  const input = JSON.parse(await readFile(join(scenarioDir, 'input.json'), 'utf8')) as {
    steps?: { op?: unknown; text?: unknown }[]
  }
  const prompt = input.steps?.find(step => step.op === 'prompt')?.text
  if (typeof prompt !== 'string') throw new Error('verified-control snapshot input has no prompt step')
  return prompt
}

async function persistedLog(cwd: string): Promise<string> {
  const files = (await readdir(join(cwd, '.sessions'), { recursive: true }))
    .filter(file => file.endsWith('.jsonl'))
  if (files.length !== 1 || files[0] === undefined) {
    throw new Error(`verified-control snapshot persisted ${files.length} session logs`)
  }
  return readFile(join(cwd, '.sessions', files[0]), 'utf8')
}

function eventOf(record: JsonObject): JsonObject | undefined {
  const event = record.event
  return event !== null && typeof event === 'object' && !Array.isArray(event)
    ? event as JsonObject
    : undefined
}

describe('verified-control headless snapshot', () => {
  it('replays a keyless Fable Goal Contract through the real headless profile', async () => {
    const prompt = await scenarioPrompt()
    const streamExpected = join(scenarioDir, 'stream-json.expected.jsonl')
    const sessionExpected = join(scenarioDir, 'session.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'verified-control headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-verified-control-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, prompt],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: join(scenarioDir, 'session.jsonl'),
        DSH_SNAPSHOT_OVERRIDE: join(scenarioDir, 'replay.override.json'),
        DSH_TEST_EXTRA_OVERLAYS: verifiedBundlePatch,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: (cwd) => { runCwd = cwd },
      inspect: async (cwd) => {
        const rawSession = await persistedLog(cwd)
        const rows = parseJsonl(rawSession)
        const calls = rows.filter(row => row.type === 'tool/call')
          .map(row => (row.data as JsonObject | undefined)?.name)
        expect(calls).toEqual(['create_goal', 'control_set_contract', 'control_get_state'])

        const snapshots = rows.filter(row => row.type === 'verified-control/snapshot')
        expect(snapshots.length).toBeGreaterThan(0)
        const latest = snapshots.at(-1)?.data as JsonObject | undefined
        const state = latest?.state as JsonObject | undefined
        const contract = state?.contract as JsonObject | undefined
        expect(contract).toMatchObject({
          objective: 'Establish the verified-control snapshot contract',
          requestedAuthority: {
            mutation: false,
            network: false,
            irreversible: false,
            delegation: false,
          },
        })

        const normalizedSession = normalizeControlTimes(normalizeSessionSnapshot(rawSession, contextFromLog(rawSession)))
        if (refreshing) await writeFile(sessionExpected, normalizedSession)
        expect(normalizedSession).toBe(await readFile(sessionExpected, 'utf8'))
      },
    })

    expect(result.stderr).toBe('')
    const rawRecords = parseJsonl(result.stdout)
    const headerEvent = rawRecords.map(eventOf).find(event => event?.type === 'request/header')
    const headerData = headerEvent?.data as JsonObject | undefined
    const header = headerData?.header as JsonObject | undefined
    expect(header?.config).toEqual({
      provider: 'anthropic',
      model: 'claude-fable-5-1',
      reasoningEffort: 'low',
    })
    expect(header?.system).toEqual(expect.stringContaining('When verified-control tools are available, treat them as the hard control plane'))
    const tools = header?.tools
    if (!Array.isArray(tools)) throw new Error('verified-control request header did not contain tool schemas')
    const controlTools = (tools as JsonObject[])
      .map(tool => tool.name)
      .filter((name): name is string => typeof name === 'string' && name.startsWith('control_'))
      .sort()
    expect(controlTools).toEqual([
      'control_amend_contract',
      'control_attest_fact',
      'control_get_state',
      'control_invalidate_fact',
      'control_observe_fact',
      'control_prepare_delegation',
      'control_reconcile_external_effect',
      'control_set_contract',
      'control_verify_fact',
    ])
    expect(result.stdout).toContain('Claude Fable 5.1 execution guidance for this step:')
    expect(result.stdout).toContain('At low effort')
    expect(rawRecords.at(-1)).toMatchObject({ type: 'result', output: 'VERIFIED_CONTROL_READY' })

    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
