import { describe, expect, it } from 'vitest'
import { baseToolDecision, type PolicyConfig } from '../src/policy.ts'
import { EMPTY_CONTROL_STATE } from '../src/types.ts'

const config: PolicyConfig = { enforceWithoutContract: true, requireGoalForControlledWork: true, allowMutation: true, allowNetwork: false, allowIrreversible: false, allowDelegation: true, maxToolCalls: 100, maxFailures: 10, maxDurationMs: 100_000, maxRepeatedToolCalls: 8, maxDelegations: 2, mutationTools: ['write', 'edit'], networkTools: ['web_fetch'], irreversibleTools: [], delegationTools: ['subagent'] }
const contract = { objective: 'parent', success: [{ description: 'done' }], invariants: [], nonGoals: [], requestedAuthority: { mutation: true, network: false, irreversible: false, delegation: true }, requestedBudget: { maxToolCalls: 20, maxFailures: 5, maxDelegations: 1 } }
const goal = { id: 'goal-1', revision: 1, objective: 'parent', phase: 'active', activation: 'armed', maxGoalRounds: 8, roundsStarted: 0, createdAt: 1, updatedAt: 1 }
function fixture(state: any, currentGoal: any = goal) { const agent = { session: {} } as any; const ctx = { sessionProjections: { stateOf: () => state }, goals: { get: () => currentGoal } } as any; return { agent, ctx } }
function exec(agent: any, name: string, args: Record<string, unknown> = {}) { return { agent, name, arguments: args, signal: new AbortController().signal } as any }

describe('verified control policy', () => {
  it('requires a prepared typed contract for delegation', () => {
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-1' })
    expect(baseToolDecision(ctx, config, exec(agent, 'subagent'))).toEqual(expect.objectContaining({ kind: 'deny', reason: expect.stringContaining('control_prepare_delegation') }))
  })
  it('clamps delegation count to the Goal Contract budget', () => {
    const prepared = { id: 'd', objective: 'x', expectedEvidence: ['e'], resourceScope: [], createdAt: 1, status: 'prepared' }
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-1', delegations: 1, delegationContracts: { d: prepared } })
    expect(baseToolDecision(ctx, config, exec(agent, 'subagent'))).toEqual(expect.objectContaining({ kind: 'deny', reason: expect.stringContaining('delegation budget exhausted') }))
  })
  it('allows state recovery reads after operational budgets are exhausted', () => {
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-1', toolCalls: 999 })
    expect(baseToolDecision(ctx, config, exec(agent, 'control_get_state'))).toEqual({ kind: 'allow' })
  })
  it('treats maxFailures zero as zero tolerated failures, not an immediate work ban', () => {
    const zeroTolerance = { ...contract, requestedBudget: { ...contract.requestedBudget, maxFailures: 0 } }
    const healthy = fixture({ ...EMPTY_CONTROL_STATE, contract: zeroTolerance, contractGoalId: 'goal-1', failures: 0 })
    expect(baseToolDecision(healthy.ctx, config, exec(healthy.agent, 'write'))).toEqual({ kind: 'allow' })
    const failed = fixture({ ...EMPTY_CONTROL_STATE, contract: zeroTolerance, contractGoalId: 'goal-1', failures: 1 })
    expect(baseToolDecision(failed.ctx, config, exec(failed.agent, 'write'))).toEqual(expect.objectContaining({ kind: 'deny', reason: expect.stringContaining('failure budget exhausted') }))
  })
  it('stops ordinary work exactly when a non-zero failure tolerance is reached', () => {
    const below = fixture({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-1', failures: 4 })
    expect(baseToolDecision(below.ctx, config, exec(below.agent, 'write'))).toEqual({ kind: 'allow' })
    const exhausted = fixture({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-1', failures: 5 })
    expect(baseToolDecision(exhausted.ctx, config, exec(exhausted.agent, 'write'))).toEqual(expect.objectContaining({ kind: 'deny', reason: expect.stringContaining('failure budget exhausted') }))
  })
  it('allows verified completion to commit at an exhausted operational budget boundary', () => {
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-1', toolCalls: 20, failures: 5, startedAt: Date.now() - 200_000 })
    expect(baseToolDecision(ctx, config, exec(agent, 'update_goal', { action: 'complete' }))).toEqual({ kind: 'allow' })
  })
  it('blocks completion while recovery state is unresolved', () => {
    const externalEffects = { e: { id: 'e', tool: 'deploy', openedAt: 1, status: 'review' as const } }
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-1', externalEffects })
    expect(baseToolDecision(ctx, config, exec(agent, 'update_goal', { action: 'complete' }))).toEqual(expect.objectContaining({ kind: 'deny', reason: expect.stringContaining('reconciled') }))
  })
  it('rejects a contract bound to a different durable goal', () => {
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-old' })
    expect(baseToolDecision(ctx, config, exec(agent, 'write'))).toEqual(expect.objectContaining({ kind: 'deny', reason: expect.stringContaining('not bound to the current durable goal') }))
  })
  it('rejects objective drift until the contract is explicitly amended', () => {
    const editedGoal = { ...goal, revision: 2, objective: 'expanded parent' }
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-1' }, editedGoal)
    expect(baseToolDecision(ctx, config, exec(agent, 'write'))).toEqual(expect.objectContaining({ kind: 'deny', reason: expect.stringContaining('objective differs') }))
  })
  it('keeps contract establishment available when stale operational counters are exhausted', () => {
    const { agent, ctx } = fixture({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-old', toolCalls: 999, failures: 999 })
    expect(baseToolDecision(ctx, config, exec(agent, 'control_set_contract'))).toEqual({ kind: 'allow' })
  })
})
