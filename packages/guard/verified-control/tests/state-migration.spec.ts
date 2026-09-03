import { describe, expect, it } from 'vitest'
import { normalizeControlState } from '../src/fold.ts'

describe('verified-control state migration', () => {
  it('fills fields added after an older durable snapshot was written', () => {
    const migrated = normalizeControlState({ contract: null, facts: {}, toolCalls: 3, failures: 1 } as any)
    expect(migrated.toolCalls).toBe(3)
    expect(migrated.contractGoalId).toBeNull()
    expect(migrated.delegationContracts).toEqual({})
    expect(migrated.externalEffects).toEqual({})
    expect(migrated.lastTool).toEqual({ signature: null, repeated: 0 })
  })
})
