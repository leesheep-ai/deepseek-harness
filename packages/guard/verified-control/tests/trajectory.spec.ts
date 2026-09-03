import { describe, expect, it } from 'vitest'
import { chooseReasoningEffort } from '../src/effort.ts'
import { hasPreparedDelegation, prepareDelegation } from '../src/delegation-runtime.ts'
import { EMPTY_CONTROL_STATE } from '../src/types.ts'

const effort = { enabled: true, baseline: 'medium', elevated: 'high', critical: 'xhigh', failureThreshold: 2, criticalFailureThreshold: 4, repetitionThreshold: 4 }
const contract = { objective: 'parent', success: [{ description: 'done' }], invariants: [], nonGoals: [], requestedAuthority: { mutation: true, network: false, irreversible: false, delegation: true }, requestedBudget: { maxToolCalls: 10, maxFailures: 2, maxDelegations: 2 } }

describe('trajectory controller', () => {
  it('escalates effort only when trajectory risk increases', () => {
    expect(chooseReasoningEffort(EMPTY_CONTROL_STATE, effort)).toBe('medium')
    expect(chooseReasoningEffort({ ...EMPTY_CONTROL_STATE, consecutiveFailures: 2 }, effort)).toBe('high')
    expect(chooseReasoningEffort({ ...EMPTY_CONTROL_STATE, consecutiveFailures: 4 }, effort)).toBe('xhigh')
    expect(chooseReasoningEffort({ ...EMPTY_CONTROL_STATE, externalEffects: { e: { id: 'e', tool: 'deploy', openedAt: 1, status: 'review' } } }, effort)).toBe('xhigh')
  })
  it('requires a parent contract before creating typed delegated work', () => {
    expect(() => prepareDelegation(EMPTY_CONTROL_STATE, { objective: 'x', expectedEvidence: ['result'], resourceScope: [] })).toThrow('Goal Contract')
    const prepared = prepareDelegation({ ...EMPTY_CONTROL_STATE, contract }, { objective: 'inspect auth', expectedEvidence: ['root cause'], resourceScope: ['src/auth/**'] })
    expect(hasPreparedDelegation(prepared.state)).toBe(true)
    expect(prepared.delegation.resourceScope).toEqual(['src/auth/**'])
  })
})
