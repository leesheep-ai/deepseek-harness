import { describe, expect, it, vi } from 'vitest'
import { continuationBlocker, installContinuationGate } from '../src/continuation-gate.ts'
import type { PolicyConfig } from '../src/policy.ts'
import { EMPTY_CONTROL_STATE } from '../src/types.ts'

const config: PolicyConfig = {
  enforceWithoutContract: true,
  requireGoalForControlledWork: true,
  allowMutation: true,
  allowNetwork: false,
  allowIrreversible: false,
  allowDelegation: true,
  maxToolCalls: 100,
  maxFailures: 10,
  maxDurationMs: 100_000,
  maxRepeatedToolCalls: 8,
  maxDelegations: 2,
  mutationTools: ['write', 'edit'],
  networkTools: ['web_fetch'],
  irreversibleTools: [],
  delegationTools: ['subagent'],
}

const contract = {
  objective: 'finish the task',
  success: [{ description: 'done' }],
  invariants: [],
  nonGoals: [],
  requestedAuthority: { mutation: true, network: false, irreversible: false, delegation: true },
  requestedBudget: { maxToolCalls: 20, maxFailures: 5, maxDurationMs: 10_000, maxRepeatedToolCalls: 3 },
}

describe('verified-control continuation gate', () => {
  it('uses the tighter Goal Contract budget', () => {
    const state = { ...EMPTY_CONTROL_STATE, contract, toolCalls: 20 }
    expect(continuationBlocker(state, config)).toEqual(expect.objectContaining({ code: 'tool-call-budget' }))
  })

  it('blocks unresolved recovery before considering ordinary budgets', () => {
    const state = {
      ...EMPTY_CONTROL_STATE,
      contract,
      externalEffects: {
        effect: { id: 'effect', tool: 'deploy', openedAt: 1, status: 'review' as const },
      },
    }
    expect(continuationBlocker(state, config)).toEqual(expect.objectContaining({ code: 'external-effect-review' }))
  })

  it('treats maxFailures zero as zero tolerated failures rather than an immediate stop', () => {
    const zeroTolerance = { ...contract, requestedBudget: { ...contract.requestedBudget, maxFailures: 0 } }
    expect(continuationBlocker({ ...EMPTY_CONTROL_STATE, contract: zeroTolerance, failures: 0 }, config)).toBeUndefined()
    expect(continuationBlocker({ ...EMPTY_CONTROL_STATE, contract: zeroTolerance, failures: 1 }, config))
      .toEqual(expect.objectContaining({ code: 'failure-budget' }))
  })

  it('detects duration and repetition stalls but leaves healthy work alone', () => {
    const healthy = { ...EMPTY_CONTROL_STATE, contract, startedAt: 1_000 }
    expect(continuationBlocker(healthy, config, 2_000)).toBeUndefined()
    expect(continuationBlocker(healthy, config, 11_000)).toEqual(expect.objectContaining({ code: 'duration-budget' }))
    expect(continuationBlocker({ ...healthy, lastTool: { signature: 'read:{}', repeated: 4 } }, config, 2_000))
      .toEqual(expect.objectContaining({ code: 'repetition-stall' }))
  })

  it('transitions an armed active goal to blocked at turn stop', () => {
    let stop: ((payload: any) => void) | undefined
    const block = vi.fn()
    const agent = { session: {} }
    const state = { ...EMPTY_CONTROL_STATE, contract, failures: 6 }
    const ctx = {
      on(event: string, handler: (payload: any) => void) {
        if (event === 'agent/turn-stopping') stop = handler
      },
      sessionProjections: { stateOf: () => state },
      goals: {
        get: () => ({ id: 'goal-1', revision: 3, phase: 'active', activation: 'armed' }),
        block,
      },
      logger: { warn: vi.fn() },
    } as any

    installContinuationGate(ctx, config)
    expect(stop).toBeTypeOf('function')
    stop?.({ agent, turn: 1, signal: new AbortController().signal })

    expect(block).toHaveBeenCalledWith(
      agent,
      { id: 'goal-1', revision: 3 },
      expect.objectContaining({ code: 'failure-budget' }),
    )
  })
})
