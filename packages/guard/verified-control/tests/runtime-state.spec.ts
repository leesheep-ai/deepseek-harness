import { describe, expect, it } from 'vitest'
import { hasCurrentGoal, setContract } from '../src/runtime-state.ts'
import { EMPTY_CONTROL_STATE } from '../src/types.ts'

const contract = {
  objective: 'new goal',
  success: [{ description: 'done' }],
  invariants: [],
  nonGoals: [],
  requestedAuthority: { mutation: true, network: false, irreversible: false },
  requestedBudget: { maxToolCalls: 20, maxFailures: 5 },
}

function harness(initial: any, goal: any) {
  let state = structuredClone(initial)
  const session = {
    append(type: string, data: any) {
      expect(type).toBe('verified-control/snapshot')
      state = structuredClone(data.state)
    },
  } as any
  const ctx = {
    sessionProjections: { stateOf: () => state },
    goals: { get: () => goal },
  } as any
  const agent = { ctx, session } as any
  return { agent, state: () => state }
}

const activeGoal = {
  id: 'goal-new', revision: 1, objective: 'new goal', phase: 'active', activation: 'armed',
  maxGoalRounds: 8, roundsStarted: 0, createdAt: 1, updatedAt: 1,
}

describe('verified-control contract lifecycle', () => {
  it('resets only goal-scoped state when binding a contract to a new goal', () => {
    const fact = { key: 'workspace', value: 'clean', origin: 'verifier', source: 'test', confidence: 1, observedAt: 1, verifiedBy: ['test'], dependencies: [], valid: true }
    const external = { id: 'effect', tool: 'deploy', openedAt: 1, status: 'review' }
    const incident = { id: 'incident', kind: 'tool-failure', message: 'old failure', createdAt: 1, regressionEval: { name: 'regression:test', assertion: 'do not repeat' } }
    const initial = {
      ...EMPTY_CONTROL_STATE,
      contract: { ...contract, objective: 'old goal' },
      contractGoalId: 'goal-old',
      facts: { workspace: fact },
      externalEffects: { effect: external },
      incidents: [incident],
      toolCalls: 19,
      failures: 4,
      successfulTools: 15,
      consecutiveFailures: 2,
      delegations: 2,
      delegationContracts: { d: { id: 'd', objective: 'old', expectedEvidence: ['x'], resourceScope: [], createdAt: 1, status: 'prepared' } },
      lastTool: { signature: 'write:{}', repeated: 4 },
      startedAt: 10,
      recoveries: 3,
    }
    const test = harness(initial, activeGoal)

    setContract(test.agent, contract)
    const state = test.state()

    expect(state.contractGoalId).toBe('goal-new')
    expect(state.contract).toEqual(contract)
    expect(state.toolCalls).toBe(0)
    expect(state.failures).toBe(0)
    expect(state.successfulTools).toBe(0)
    expect(state.consecutiveFailures).toBe(0)
    expect(state.delegations).toBe(0)
    expect(state.delegationContracts).toEqual({})
    expect(state.lastTool).toEqual({ signature: null, repeated: 0 })
    expect(state.recoveries).toBe(0)
    expect(state.startedAt).toEqual(expect.any(Number))
    expect(state.facts).toEqual(initial.facts)
    expect(state.externalEffects).toEqual(initial.externalEffects)
    expect(state.incidents).toEqual(initial.incidents)
  })

  it('preserves consumed budgets when amending the same goal contract', () => {
    const initial = { ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-new', toolCalls: 7, failures: 2, startedAt: 123 }
    const test = harness(initial, activeGoal)
    const amended = { ...contract, requestedBudget: { ...contract.requestedBudget, maxToolCalls: 30 } }

    setContract(test.agent, amended, true)

    expect(test.state()).toMatchObject({ contract: amended, contractGoalId: 'goal-new', toolCalls: 7, failures: 2, startedAt: 123 })
  })

  it('rejects replacing the same goal contract without the amendment path', () => {
    const test = harness({ ...EMPTY_CONTROL_STATE, contract, contractGoalId: 'goal-new' }, activeGoal)
    expect(() => setContract(test.agent, contract)).toThrow('already set for the current goal')
  })

  it('rejects a contract whose objective does not match the durable goal', () => {
    const test = harness(EMPTY_CONTROL_STATE, activeGoal)
    expect(() => setContract(test.agent, { ...contract, objective: 'different' })).toThrow('must exactly match')
  })

  it('does not treat a completed goal as current controlled work', () => {
    const test = harness(EMPTY_CONTROL_STATE, { ...activeGoal, phase: 'complete', activation: 'disarmed' })
    expect(hasCurrentGoal(test.agent.ctx, test.agent)).toBe(false)
    expect(() => setContract(test.agent, contract)).toThrow('completed goal')
  })
})
