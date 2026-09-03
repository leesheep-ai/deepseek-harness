import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { applyVerifiedControlEvent } from './fold.ts'
import { verifyChecks } from './verifier.ts'
import { EMPTY_CONTROL_STATE, type GoalContract, type VerifiedControlState } from './types.ts'

export * from './types.ts'
export * from './fold.ts'
export * from './transaction.ts'
export * from './verifier.ts'

export const name = 'verified-control'
export const inject = ['fs', 'goals', 'sessionProjections', 'tools']

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

function parseContract(value: unknown): GoalContract {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('contract must be an object')
  const raw = value as Record<string, unknown>
  const objective = raw.objective
  const success = raw.success
  const invariants = raw.invariants
  const nonGoals = raw.nonGoals
  const authority = raw.requestedAuthority
  const budget = raw.requestedBudget
  if (typeof objective !== 'string' || objective.trim().length === 0) throw new TypeError('contract.objective must be non-empty')
  if (!Array.isArray(success) || success.length === 0) throw new TypeError('contract.success must be a non-empty array')
  if (!Array.isArray(invariants) || !Array.isArray(nonGoals)) throw new TypeError('contract.invariants/nonGoals must be arrays')
  if (typeof authority !== 'object' || authority === null || Array.isArray(authority)) throw new TypeError('contract.requestedAuthority must be an object')
  if (typeof budget !== 'object' || budget === null || Array.isArray(budget)) throw new TypeError('contract.requestedBudget must be an object')
  const a = authority as Record<string, unknown>
  const b = budget as Record<string, unknown>
  if (typeof a.mutation !== 'boolean' || typeof a.network !== 'boolean' || typeof a.irreversible !== 'boolean') throw new TypeError('contract authority flags must be booleans')
  if (!Number.isSafeInteger(b.maxToolCalls) || (b.maxToolCalls as number) < 1 || !Number.isSafeInteger(b.maxFailures) || (b.maxFailures as number) < 0) throw new TypeError('contract budgets are invalid')
  const parseVerifier = (value: unknown, index: number): GoalContract['success'][number]['verifier'] => {
    if (value === undefined) return undefined
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`contract verifier ${index} must be an object`)
    const verifier = value as Record<string, unknown>
    if (verifier.kind === 'file_exists' || verifier.kind === 'file_not_exists') {
      if (typeof verifier.path !== 'string' || verifier.path.length === 0) throw new TypeError(`contract verifier ${index} requires path`)
      return { kind: verifier.kind, path: verifier.path }
    }
    if (verifier.kind === 'file_content_equals') {
      if (typeof verifier.path !== 'string' || typeof verifier.content !== 'string') throw new TypeError(`contract verifier ${index} requires path and content`)
      return { kind: 'file_content_equals', path: verifier.path, content: verifier.content }
    }
    if (verifier.kind === 'fact_equals') {
      if (typeof verifier.key !== 'string' || verifier.key.length === 0 || !Object.hasOwn(verifier, 'value')) throw new TypeError(`contract verifier ${index} requires key and value`)
      return { kind: 'fact_equals', key: verifier.key, value: verifier.value as GoalContract['success'][number]['verifier'] extends { kind: 'fact_equals'; value: infer V } ? V : never }
    }
    throw new TypeError(`contract verifier ${index} has unsupported kind`)
  }
  const parseChecks = (items: unknown[]): GoalContract['success'] => items.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new TypeError(`contract check ${index} must be an object`)
    const check = item as Record<string, unknown>
    if (typeof check.description !== 'string' || check.description.trim().length === 0) throw new TypeError(`contract check ${index} needs description`)
    const verifier = parseVerifier(check.verifier, index)
    return { description: check.description, ...(verifier === undefined ? {} : { verifier }) }
  })
  if (!nonGoals.every(item => typeof item === 'string')) throw new TypeError('contract.nonGoals must contain strings')
  return {
    objective: objective.trim(),
    success: parseChecks(success),
    invariants: parseChecks(invariants),
    nonGoals: nonGoals as string[],
    requestedAuthority: { mutation: a.mutation, network: a.network, irreversible: a.irreversible },
    requestedBudget: { maxToolCalls: b.maxToolCalls as number, maxFailures: b.maxFailures as number },
  }
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
  if (exec.name === 'update_goal' && typeof exec.arguments === 'object' && exec.arguments !== null
    && (exec.arguments as Record<string, unknown>).action === 'complete') {
    if (contract === null) return { kind: 'deny', reason: 'goal completion requires a Goal Contract' }
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

const verifiedControlStateSchema = zod.object({
  contract: zod.unknown().nullable(),
  facts: zod.record(zod.string(), zod.unknown()),
  openTransactions: zod.record(zod.string(), zod.unknown()),
  externalEffects: zod.record(zod.string(), zod.unknown()),
  toolCalls: zod.number().int().nonnegative(),
  failures: zod.number().int().nonnegative(),
}) as unknown as ZodType<VerifiedControlState>

export const verifiedControlProjection = {
  key: 'verified-control',
  stateSchema: verifiedControlStateSchema,
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
  ctx.tools.register(defineTool({
    name: 'control_set_contract',
    description: 'Set the durable Goal Contract for the current long-running goal. The contract requests authority and budgets; deployment policy can only reduce them. Declare deterministic success verifiers whenever possible.',
    parameters: {
      contract: { type: 'json', required: true, description: 'Goal Contract object: objective, success, invariants, nonGoals, requestedAuthority, requestedBudget.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { accepted: { type: 'boolean', required: true }, objective: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      if (exec.agent === undefined) throw new Error('control_set_contract requires an agent')
      if (config.requireGoalForControlledWork && !hasCurrentGoal(ctx, exec.agent)) throw new Error('create a durable goal before setting its Goal Contract')
      const contract = parseContract(args.contract)
      setContract(exec.agent, contract)
      return Promise.resolve({ accepted: true, objective: contract.objective })
    },
  }))

  ctx.on('tools/pre-execute', async (exec, next) => {
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    const base = preToolDecision(ctx, config, exec)
    if (base.kind !== 'allow') return base
    if (exec.agent !== undefined && exec.name === 'update_goal' && typeof exec.arguments === 'object' && exec.arguments !== null
      && (exec.arguments as Record<string, unknown>).action === 'complete') {
      const state = stateOf(ctx, exec.agent)
      if (state.contract === null) return { kind: 'deny', reason: 'goal completion requires a Goal Contract' }
      const invariantVerification = await verifyChecks(ctx, state, state.contract.invariants, exec.signal)
      if (state.contract.invariants.length > 0 && !invariantVerification.passed) {
        const failed = invariantVerification.results.filter(result => !result.passed).map(result => `${result.description}: ${result.reason}`).join('; ')
        return { kind: 'deny', reason: `Goal Contract invariant verification failed: ${failed}` }
      }
      const verification = await verifyChecks(ctx, state, state.contract.success, exec.signal)
      if (!verification.passed) {
        const failed = verification.results.filter(result => !result.passed).map(result => `${result.description}: ${result.reason}`).join('; ')
        return { kind: 'deny', reason: `Goal Contract completion verification failed (coverage ${Math.round(verification.coverage * 100)}%): ${failed}` }
      }
    }
    return base
  })
}
