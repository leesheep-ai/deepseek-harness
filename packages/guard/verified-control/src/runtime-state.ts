import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEventMap } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { GoalContract, TrustedFact, VerifiedControlState } from './types.ts'

export function hasCurrentGoal(ctx: Context, agent: Agent): boolean {
  try { return ctx.goals.get(agent) !== undefined } catch { return false }
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
  appendState(agent, current => {
    if (!replace && current.contract !== null) throw new Error('Goal Contract is already set; use control_amend_contract with human approval')
    return { ...current, contract: structuredClone(contract), startedAt: current.startedAt ?? Date.now() }
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
