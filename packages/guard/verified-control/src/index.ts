import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { applyVerifiedControlEvent } from './fold.ts'
import { EMPTY_CONTROL_STATE, type GoalContract, type VerifiedControlState } from './types.ts'

export * from './types.ts'
export * from './fold.ts'
export * from './transaction.ts'

export const name = 'verified-control'
export const inject = ['goals', 'sessionProjections', 'tools']

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'verified-control/snapshot': { state: VerifiedControlState }
  }
}

declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap {
    'verified-control': VerifiedControlState
  }
}

export interface Config {
  enforceWithoutContract?: boolean
  requireGoalForControlledWork?: boolean
  allowMutation?: boolean
  allowNetwork?: boolean
  allowIrreversible?: boolean
  maxToolCalls?: number
  maxFailures?: number
  mutationTools?: string[]
  networkTools?: string[]
  irreversibleTools?: string[]
}

export const Config: z<Config> = z.object({
  enforceWithoutContract: z.boolean().default(true),
  requireGoalForControlledWork: z.boolean().default(true),
  allowMutation: z.boolean().default(true),
  allowNetwork: z.boolean().default(false),
  allowIrreversible: z.boolean().default(false),
  maxToolCalls: z.number().step(1).min(1).default(512),
  maxFailures: z.number().step(1).min(0).default(32),
  mutationTools: z.array(z.string()).default(['write', 'edit']),
  networkTools: z.array(z.string()).default(['web_search', 'web_fetch']),
  irreversibleTools: z.array(z.string()).default([]),
})

function hasCurrentGoal(ctx: Context, agent: Agent): boolean {
  try {
    return ctx.goals.get(agent) !== undefined
  } catch {
    return false
  }
}

function stateOf(ctx: Context, agent: Agent): VerifiedControlState {
  return ctx.sessionProjections.stateOf(agent.session, 'verified-control')
}

function effectiveAllow(requested: boolean, platform: boolean): boolean {
  return requested && platform
}

function preToolDecision(ctx: Context, config: Required<Config>, exec: ToolExecution): PreToolDecision {
  const agent = exec.agent
  if (agent === undefined) return { kind: 'allow' }
  const state = stateOf(ctx, agent)
  const contract = state.contract
  const mutation = config.mutationTools.includes(exec.name)
  const network = config.networkTools.includes(exec.name)
  const irreversible = config.irreversibleTools.includes(exec.name)
  const controlled = mutation || network || irreversible

  if (state.toolCalls >= Math.min(contract?.requestedBudget.maxToolCalls ?? config.maxToolCalls, config.maxToolCalls)) {
    return { kind: 'deny', reason: 'verified-control tool-call budget exhausted' }
  }
  if (state.failures >= Math.min(contract?.requestedBudget.maxFailures ?? config.maxFailures, config.maxFailures)) {
    return { kind: 'deny', reason: 'verified-control failure budget exhausted' }
  }
  if (!controlled) return { kind: 'allow' }
  if (contract === null) {
    return config.enforceWithoutContract
      ? { kind: 'deny', reason: 'controlled work requires a Goal Contract' }
      : { kind: 'allow' }
  }
  if (config.requireGoalForControlledWork && !hasCurrentGoal(ctx, agent)) {
    return { kind: 'deny', reason: 'controlled work requires an active durable goal' }
  }
  if (mutation && !effectiveAllow(contract.requestedAuthority.mutation, config.allowMutation)) {
    return { kind: 'deny', reason: 'mutation authority was not granted by both contract and deployment policy' }
  }
  if (network && !effectiveAllow(contract.requestedAuthority.network, config.allowNetwork)) {
    return { kind: 'deny', reason: 'network authority was not granted by both contract and deployment policy' }
  }
  if (irreversible && !effectiveAllow(contract.requestedAuthority.irreversible, config.allowIrreversible)) {
    return { kind: 'ask', reason: 'irreversible action requires explicit approval' }
  }
  return { kind: 'allow' }
}

export const verifiedControlProjection = {
  key: 'verified-control',
  init: (): VerifiedControlState => structuredClone(EMPTY_CONTROL_STATE),
  apply: (state: VerifiedControlState, event: SessionEvent) => applyVerifiedControlEvent(state, event),
  stateVersion: 1,
} satisfies ProjectionDefinition<'verified-control', VerifiedControlState>

export function setContract(agent: Agent, contract: GoalContract): void {
  const current = agent.ctx.sessionProjections.stateOf(agent.session, 'verified-control')
  agent.session.append('verified-control/snapshot', {
    state: { ...current, contract: structuredClone(contract) },
  } satisfies SessionEventMap['verified-control/snapshot'])
}

export function apply(ctx: Context, input: Config = {}): void {
  const config: Required<Config> = {
    enforceWithoutContract: input.enforceWithoutContract ?? true,
    requireGoalForControlledWork: input.requireGoalForControlledWork ?? true,
    allowMutation: input.allowMutation ?? true,
    allowNetwork: input.allowNetwork ?? false,
    allowIrreversible: input.allowIrreversible ?? false,
    maxToolCalls: input.maxToolCalls ?? 512,
    maxFailures: input.maxFailures ?? 32,
    mutationTools: input.mutationTools ?? ['write', 'edit'],
    networkTools: input.networkTools ?? ['web_search', 'web_fetch'],
    irreversibleTools: input.irreversibleTools ?? [],
  }

  ctx.sessionProjections.register(verifiedControlProjection)
  ctx.on('tools/pre-execute', async (exec, next) => {
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    return preToolDecision(ctx, config, exec)
  })
}
