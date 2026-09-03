import { describe, expect, it } from 'vitest'
import { verifyChecks, verifySpec } from '../src/verifier.ts'
import { EMPTY_CONTROL_STATE, type TrustedFact } from '../src/types.ts'

function ctx(files: Record<string, string> = {}) {
  return {
    fs: {
      async resolve(path: string) { return { displayPath: path, targetKey: path } },
      async stat(target: { displayPath: string }) { return Object.hasOwn(files, target.displayPath) ? { type: 'file', version: 'v' } : undefined },
      async readText(target: { displayPath: string }) { return files[target.displayPath] as string },
    },
    get(name: string) {
      if (name !== 'shell') return undefined
      return {
        resolve: (request: { command: string }) => request,
        run: async (spec: { command: string }) => ({ exitCode: spec.command === 'ok' ? 0 : 1, timedOut: false, aborted: false }),
      }
    },
  } as any
}

const modelFact = (verifiedBy: string[]): TrustedFact => ({
  key: 'a', value: 1, origin: 'model', source: 'model:test', confidence: 1,
  observedAt: Date.now(), verifiedBy, dependencies: [], valid: true,
})

describe('verified-control verifier mesh', () => {
  it('does not let a model observation self-certify', async () => {
    const state = { ...EMPTY_CONTROL_STATE, facts: { a: modelFact([]) } }
    expect((await verifySpec(ctx(), state, { kind: 'fact_equals', key: 'a', value: 1 })).passed).toBe(false)
  })

  it('accepts an independently certified fact', async () => {
    const state = { ...EMPTY_CONTROL_STATE, facts: { a: modelFact(['human']) } }
    expect((await verifySpec(ctx(), state, { kind: 'fact_equals', key: 'a', value: 1 })).passed).toBe(true)
  })

  it('fails closed when a declared check has no verifier', async () => {
    const result = await verifyChecks(ctx(), EMPTY_CONTROL_STATE, [{ description: 'hard safety invariant' }])
    expect(result.passed).toBe(false)
    expect(result.coverage).toBe(0)
  })

  it('treats an empty invariant set as vacuously verified', async () => {
    const result = await verifyChecks(ctx(), EMPTY_CONTROL_STATE, [])
    expect(result.passed).toBe(true)
    expect(result.coverage).toBe(1)
  })

  it('supports file_contains and command_succeeds', async () => {
    const fake = ctx({ 'a.txt': 'hello world' })
    expect((await verifySpec(fake, EMPTY_CONTROL_STATE, { kind: 'file_contains', path: 'a.txt', content: 'world' })).passed).toBe(true)
    expect((await verifySpec(fake, EMPTY_CONTROL_STATE, { kind: 'command_succeeds', command: 'ok' })).passed).toBe(true)
    expect((await verifySpec(fake, EMPTY_CONTROL_STATE, { kind: 'command_succeeds', command: 'bad' })).passed).toBe(false)
  })
})
