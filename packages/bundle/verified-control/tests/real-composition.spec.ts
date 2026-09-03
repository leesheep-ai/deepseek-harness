import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/real-composition/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/real-composition/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('verified-control real Loader composition', () => {
  it('mounts the bundle into the base profile and exposes its real model/control surfaces', async () => {
    const result = await runLoaderSmoke({
      label: 'verified-control real composition snapshot',
      tempDirPrefix: 'verified-control-real-composition-',
      binScript,
      configPath,
      tsconfigPath,
      mode: 'src',
    })

    expect(result.stderr).toBe('')
    const snapshot = JSON.parse(result.stdout) as {
      policy: string | null
      fableContext: string | null
      controlTools: string[]
      projectionRegistered: boolean
    }
    expect(snapshot.policy).toContain('hard control plane for long-running work')
    expect(snapshot.fableContext).toContain('Claude Fable 5.1 execution guidance for this step:')
    expect(snapshot.fableContext).toContain('At low effort')
    expect(snapshot.controlTools).toEqual([
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
    expect(snapshot.projectionRegistered).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
