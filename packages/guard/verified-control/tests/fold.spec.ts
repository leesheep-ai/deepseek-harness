import { describe, expect, it } from 'vitest'
import { applyVerifiedControlEvent, validFacts } from '../src/fold.ts'
import { EMPTY_CONTROL_STATE } from '../src/types.ts'

describe('verified-control fold', () => {
  it('filters expired facts from the current truth view', () => {
    const state = {
      ...EMPTY_CONTROL_STATE,
      facts: {
        fresh: { key: 'fresh', value: 1, origin: 'verifier' as const, source: 'test', confidence: 1, observedAt: 10, validUntil: 100, verifiedBy: ['test'], dependencies: [], valid: true },
        stale: { key: 'stale', value: 2, origin: 'verifier' as const, source: 'test', confidence: 1, observedAt: 10, validUntil: 20, verifiedBy: ['test'], dependencies: [], valid: true },
      },
    }
    expect(validFacts(state, 50)).toEqual({ fresh: 1 })
  })

  it('counts durable tool errors from the real tool-result block tag', () => {
    const event = {
      type: 'tool/result', seq: 1, time: 100,
      data: { message: { source: { kind: 'tool', callId: 'x' }, content: [{ type: 'tool-result', toolCallId: 'x', content: [], isError: true }] }, error: { code: 'TEST' } },
    } as any
    const next = applyVerifiedControlEvent(EMPTY_CONTROL_STATE, event)
    expect(next.toolCalls).toBe(1)
    expect(next.failures).toBe(1)
    expect(next.consecutiveFailures).toBe(1)
    expect(next.incidents).toHaveLength(1)
  })

  it('tracks repeated tool signatures', () => {
    const event = { type: 'tool/call', seq: 1, time: 100, data: { name: 'read', arguments: '{"file_path":"a"}' } } as any
    const once = applyVerifiedControlEvent(EMPTY_CONTROL_STATE, event)
    const twice = applyVerifiedControlEvent(once, event)
    expect(twice.lastTool.repeated).toBe(2)
  })

  it('resets goal-scoped counters on durable goal creation without hiding cross-goal recovery state', () => {
    const prior = {
      ...EMPTY_CONTROL_STATE,
      contract: { objective: 'old', success: [{ description: 'done' }], invariants: [], nonGoals: [], requestedAuthority: { mutation: true, network: false, irreversible: false }, requestedBudget: { maxToolCalls: 10, maxFailures: 2 } },
      contractGoalId: 'goal-old',
      toolCalls: 9,
      failures: 2,
      delegations: 1,
      delegationContracts: { d: { id: 'd', objective: 'old', expectedEvidence: ['x'], resourceScope: [], createdAt: 1, status: 'prepared' as const } },
      startedAt: 1,
      facts: { x: { key: 'x', value: 1, origin: 'verifier' as const, source: 'test', confidence: 1, observedAt: 1, verifiedBy: ['test'], dependencies: [], valid: true } },
      externalEffects: { effect: { id: 'effect', tool: 'deploy', openedAt: 1, status: 'review' as const } },
    }
    const created = {
      type: 'goal/change', seq: 10, time: 100,
      data: { kind: 'goal/change', version: 1, operation: 'create', goal: { id: 'goal-new', revision: 1, objective: 'new', phase: 'active', maxGoalRounds: 8 }, roundsStarted: 0, createdAt: 100, updatedAt: 100 },
    } as any

    const next = applyVerifiedControlEvent(prior, created)

    expect(next.contract).toBeNull()
    expect(next.contractGoalId).toBeNull()
    expect(next.toolCalls).toBe(0)
    expect(next.failures).toBe(0)
    expect(next.delegations).toBe(0)
    expect(next.delegationContracts).toEqual({})
    expect(next.startedAt).toBeNull()
    expect(next.facts).toEqual(prior.facts)
    expect(next.externalEffects).toEqual(prior.externalEffects)
  })
})
