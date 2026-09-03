import type { Context } from '@deepseek-ai/cordis'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEventMap } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { resetGoalScopedState } from './fold.ts'
import type { GoalContract, TrustedFact, VerifiedControlState } from './types.ts'

export function currentGoal(ctx: Context, agent: Agent): GoalView | undefined {
  try { return ctx.goals.get(agent) } catch { return undefined }
}

export function hasCurrentGoal(ctx: Context, agent: Agent): boolean {
  const goal = currentGoal(ctx, agent)
  return goal !== undefined && goal.phase !== 'complete'
}

export function stateOf(ctx: Context, agent: Agent): VerifiedControlState {
  const state = ctx.sessionProjections.stateOf(agent.session, 'verified-control')
  if (state === undefined) throw new Error('verified-control projection is not registered in this agent composition')
  return state
}

export function appendState(agent: Agent, transform: (state: VerifiedControlState) => VerifiedControlState): VerifiedControlState {
  const next = transform(stateOf(agent.ctx, agent))
  agent.session.append('verified-control/snapshot', { state: structuredClone(next) } satisfies SessionEventMap['verified-control/snapshot'])
  return next
}

export function setContract(agent: Agent, contract: GoalContract, replace = false): void {
  const goal = currentGoal(agent.ctx, agent)
  if (goal?.phase === 'complete') throw new Error('cannot bind a Goal Contract to a completed goal; create a new durable goal first')
  if (goal !== undefined && contract.objective !== goal.objective) {
    throw new Error(`Goal Contract objective must exactly match the current durable goal objective: ${JSON.stringify(goal.objective)}`)
  }
  const goalId = goal === undefined ? null : String(goal.id)
  const now = Date.now()
  appendState(agent, current => {
    const sameGoal = current.contractGoalId === goalId
    if (!replace && current.contract !== null && sameGoal) {
      throw new Error('Goal Contract is already set for the current goal; use control_amend_contract with human approval')
    }
    const base = sameGoal ? current : resetGoalScopedState(current)
    return {
      ...base,
      contract: structuredClone(contract),
      contractGoalId: goalId,
      startedAt: sameGoal ? (base.startedAt ?? now) : now,
    }
  })
}

export function factFromArgs(args: { key: string; value: JsonValue; source?: string; confidence?: number; ttl_ms?: number; dependencies?: string[] }): TrustedFact {
  if (args.key.trim().length === 0) throw new TypeError('fact key must be non-empty')
  const confidence = args.confidence ?? 0.5
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError('confidence must be between 0 and 1')
  if (args.ttl_ms !== undefined && (!Number.isSafeInteger(args.ttl_ms) || args.ttl_ms < 1)) throw new TypeError('ttl_ms must be a positive safe integer')
  const observedAt = Date.now()
  return { key: args.key, value: args.value, origin: 'model', source: `model:${args.source ?? 'observation'}`, confidence, observedAt, ...(args.ttl_ms === undefined ? {} : { validUntil: observedAt + args.ttl_ms }), verifiedBy: [], dependencies: args.dependencies ?? [], valid: true }
}
