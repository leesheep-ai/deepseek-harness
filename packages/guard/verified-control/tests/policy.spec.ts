import { describe, expect, it } from 'vitest'
import { baseToolDecision, type PolicyConfig } from '../src/policy.ts'
import { EMPTY_CONTROL_STATE } from '../src/types.ts'

const config: PolicyConfig = { enforceWithoutContract: true, requireGoalForControlledWork: true, allowMutation: true, allowNetwork: false, allowIrreversible: false, allowDelegation: true, maxToolCalls: 100, maxFailures: 10, maxDurationMs: 100_000, maxRepeatedToolCalls: 8, maxDelegations: 2, mutationTools: ['write', 'edit'], networkTools: ['web_fetch'], irreversibleTools: [], delegationTools: ['subagent'] }
const contract = { objective: 'parent', success: [{ description: 'done' }], invariants: [], nonGoals: [], requestedAuthority: { mutation: true, network: false, irreversible: false, delegation: true }, requestedBudget: { maxToolCalls: 20, maxFailures: 5, maxDelegations: 1 } }
function fixture(state: any) { const agent = { session: {} } as any; const ctx = { sessionProjections: { stateOf: () => state }, goals: { get: () => ({}) } } as any; return { agent, ctx } }
function exec(agent: any, name: string) { return { agent, name, arguments: {}, signal: new AbortController().signal } as any }

describe('verified control policy', () => {
  it('requires a prepared typed contract for delegation', () => {
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract })
    expect(baseToolDecision(ctx, config, exec(agent, 'subagent'))).toEqual(expect.objectContaining({ kind: 'deny', reason: expect.stringContaining('control_prepare_delegation') }))
  })
  it('clamps delegation count to the Goal Contract budget', () => {
    const prepared = { id: 'd', objective: 'x', expectedEvidence: ['e'], resourceScope: [], createdAt: 1, status: 'prepared' }
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract, delegations: 1, delegationContracts: { d: prepared } })
    expect(baseToolDecision(ctx, config, exec(agent, 'subagent'))).toEqual(expect.objectContaining({ kind: 'deny', reason: expect.stringContaining('delegation budget exhausted') }))
  })
  it('allows state recovery reads after operational budgets are exhausted', () => {
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract, toolCalls: 999 })
    expect(baseToolDecision(ctx, config, exec(agent, 'control_get_state'))).toEqual({ kind: 'allow' })
  })
})
