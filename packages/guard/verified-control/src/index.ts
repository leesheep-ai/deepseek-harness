import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { applyVerifiedControlEvent } from './fold.ts'
import { attestFact, invalidateFact, putFact, validFacts } from './state.ts'
import { verifyChecks, verifySpec } from './verifier.ts'
import { EMPTY_CONTROL_STATE, type GoalContract, type TrustedFact, type VerificationSpec, type VerifiedControlState } from './types.ts'

export * from './types.ts'
export * from './fold.ts'
export * from './state.ts'
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
  maxDurationMs?: number
  maxRepeatedToolCalls?: number
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
  maxDurationMs: z.number().step(1).min(1).default(86_400_000),
  maxRepeatedToolCalls: z.number().step(1).min(1).default(8),
  mutationTools: z.array(z.string()).default(['write', 'edit']),
  networkTools: z.array(z.string()).default(['web_search', 'web_fetch']),
  irreversibleTools: z.array(z.string()).default([]),
})

type ResolvedConfig = Required<Config>

function hasCurrentGoal(ctx: Context, agent: Agent): boolean {
  try { return ctx.goals.get(agent) !== undefined } catch { return false }
}

function stateOf(ctx: Context, agent: Agent): VerifiedControlState {
  return ctx.sessionProjections.stateOf(agent.session, 'verified-control')
}

function appendState(agent: Agent, transform: (state: VerifiedControlState) => VerifiedControlState): VerifiedControlState {
  const next = transform(stateOf(agent.ctx, agent))
  agent.session.append('verified-control/snapshot', { state: structuredClone(next) } satisfies SessionEventMap['verified-control/snapshot'])
  return next
}

function effectiveAllow(requested: boolean, platform: boolean): boolean {
  return requested && platform
}

function parseVerificationSpec(value: unknown, label = 'verifier'): VerificationSpec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  const raw = value as Record<string, unknown>
  if (raw.kind === 'file_exists' || raw.kind === 'file_not_exists') {
    if (typeof raw.path !== 'string' || raw.path.trim().length === 0) throw new TypeError(`${label} requires path`)
    return { kind: raw.kind, path: raw.path }
  }
  if (raw.kind === 'file_content_equals' || raw.kind === 'file_contains') {
    if (typeof raw.path !== 'string' || typeof raw.content !== 'string') throw new TypeError(`${label} requires path and content`)
    return { kind: raw.kind, path: raw.path, content: raw.content }
  }
  if (raw.kind === 'fact_equals') {
    if (typeof raw.key !== 'string' || raw.key.trim().length === 0 || !Object.hasOwn(raw, 'value')) throw new TypeError(`${label} requires key and value`)
    return { kind: 'fact_equals', key: raw.key, value: raw.value as JsonValue }
  }
  if (raw.kind === 'command_succeeds') {
    if (typeof raw.command !== 'string' || raw.command.trim().length === 0) throw new TypeError(`${label} requires command`)
    if (raw.workdir !== undefined && typeof raw.workdir !== 'string') throw new TypeError(`${label}.workdir must be a string`)
    if (raw.timeoutMs !== undefined && (!Number.isSafeInteger(raw.timeoutMs) || (raw.timeoutMs as number) < 1)) throw new TypeError(`${label}.timeoutMs must be a positive safe integer`)
    return { kind: 'command_succeeds', command: raw.command, ...(raw.workdir === undefined ? {} : { workdir: raw.workdir }), ...(raw.timeoutMs === undefined ? {} : { timeoutMs: raw.timeoutMs as number }) }
  }
  throw new TypeError(`${label} has unsupported kind`)
}

function parseContract(value: unknown): GoalContract {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('contract must be an object')
  const raw = value as Record<string, unknown>
  if (typeof raw.objective !== 'string' || raw.objective.trim().length === 0) throw new TypeError('contract.objective must be non-empty')
  if (!Array.isArray(raw.success) || raw.success.length === 0) throw new TypeError('contract.success must be a non-empty array')
  if (!Array.isArray(raw.invariants) || !Array.isArray(raw.nonGoals)) throw new TypeError('contract.invariants/nonGoals must be arrays')
  if (!raw.nonGoals.every(item => typeof item === 'string')) throw new TypeError('contract.nonGoals must contain strings')
  const authority = raw.requestedAuthority
  const budget = raw.requestedBudget
  if (typeof authority !== 'object' || authority === null || Array.isArray(authority)) throw new TypeError('contract.requestedAuthority must be an object')
  if (typeof budget !== 'object' || budget === null || Array.isArray(budget)) throw new TypeError('contract.requestedBudget must be an object')
  const a = authority as Record<string, unknown>
  const b = budget as Record<string, unknown>
  for (const key of ['mutation', 'network', 'irreversible'] as const) if (typeof a[key] !== 'boolean') throw new TypeError(`contract.requestedAuthority.${key} must be boolean`)
  if (a.delegation !== undefined && typeof a.delegation !== 'boolean') throw new TypeError('contract.requestedAuthority.delegation must be boolean')
  if (!Number.isSafeInteger(b.maxToolCalls) || (b.maxToolCalls as number) < 1 || !Number.isSafeInteger(b.maxFailures) || (b.maxFailures as number) < 0) throw new TypeError('contract budgets are invalid')
  const optionalBudget = (key: 'maxDelegations' | 'maxDurationMs' | 'maxRepeatedToolCalls', min: number): number | undefined => {
    const result = b[key]
    if (result === undefined) return undefined
    if (!Number.isSafeInteger(result) || (result as number) < min) throw new TypeError(`contract.requestedBudget.${key} is invalid`)
    return result as number
  }
  const parseChecks = (items: unknown[], prefix: string): GoalContract['success'] => items.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new TypeError(`${prefix}[${index}] must be an object`)
    const check = item as Record<string, unknown>
    if (typeof check.description !== 'string' || check.description.trim().length === 0) throw new TypeError(`${prefix}[${index}] needs description`)
    return { description: check.description, ...(check.verifier === undefined ? {} : { verifier: parseVerificationSpec(check.verifier, `${prefix}[${index}].verifier`) }) }
  })
  const maxDelegations = optionalBudget('maxDelegations', 0)
  const maxDurationMs = optionalBudget('maxDurationMs', 1)
  const maxRepeatedToolCalls = optionalBudget('maxRepeatedToolCalls', 1)
  return {
    objective: raw.objective.trim(),
    success: parseChecks(raw.success, 'contract.success'),
    invariants: parseChecks(raw.invariants, 'contract.invariants'),
    nonGoals: raw.nonGoals as string[],
    requestedAuthority: { mutation: a.mutation as boolean, network: a.network as boolean, irreversible: a.irreversible as boolean, ...(a.delegation === undefined ? {} : { delegation: a.delegation as boolean }) },
    requestedBudget: {
      maxToolCalls: b.maxToolCalls as number,
      maxFailures: b.maxFailures as number,
      ...(maxDelegations === undefined ? {} : { maxDelegations }),
      ...(maxDurationMs === undefined ? {} : { maxDurationMs }),
      ...(maxRepeatedToolCalls === undefined ? {} : { maxRepeatedToolCalls }),
    },
  }
}

function maxFor(requested: number | undefined, platform: number): number {
  return Math.min(requested ?? platform, platform)
}

function unresolvedExternalReview(state: VerifiedControlState): boolean {
  return Object.values(state.externalEffects).some(effect => effect.status === 'open' || effect.status === 'review')
}

function unresolvedTransaction(state: VerifiedControlState): boolean {
  return Object.values(state.openTransactions).some(tx => tx.status === 'rollback-failed')
}

function preToolDecision(ctx: Context, config: ResolvedConfig, exec: ToolExecution): PreToolDecision {
  const agent = exec.agent
  if (agent === undefined) return { kind: 'allow' }
  const state = stateOf(ctx, agent)
  const contract = state.contract
  const mutation = config.mutationTools.includes(exec.name)
  const network = config.networkTools.includes(exec.name)
  const irreversible = config.irreversibleTools.includes(exec.name)
  const controlled = mutation || network || irreversible

  if ((unresolvedExternalReview(state) || unresolvedTransaction(state)) && controlled) return { kind: 'deny', reason: 'verified-control recovery/reconciliation is required before more controlled work' }
  if (state.toolCalls >= maxFor(contract?.requestedBudget.maxToolCalls, config.maxToolCalls)) return { kind: 'deny', reason: 'verified-control tool-call budget exhausted' }
  if (state.failures >= maxFor(contract?.requestedBudget.maxFailures, config.maxFailures)) return { kind: 'deny', reason: 'verified-control failure budget exhausted' }
  if (contract !== null && state.startedAt !== null && Date.now() - state.startedAt >= maxFor(contract.requestedBudget.maxDurationMs, config.maxDurationMs)) return { kind: 'deny', reason: 'verified-control duration budget exhausted' }
  if (state.lastTool.repeated > maxFor(contract?.requestedBudget.maxRepeatedToolCalls, config.maxRepeatedToolCalls)) return { kind: 'deny', reason: 'verified-control repeated-tool stall detected; change strategy before retrying' }

  if (exec.name === 'control_attest_fact' || exec.name === 'control_amend_contract') return { kind: 'ask', reason: `${exec.name} requires explicit human approval` }
  if (exec.name === 'update_goal' && typeof exec.arguments === 'object' && exec.arguments !== null && (exec.arguments as Record<string, unknown>).action === 'complete' && contract === null) return { kind: 'deny', reason: 'goal completion requires a Goal Contract' }
  if (!controlled) return { kind: 'allow' }
  if (contract === null) return config.enforceWithoutContract ? { kind: 'deny', reason: 'controlled work requires a Goal Contract' } : { kind: 'allow' }
  if (config.requireGoalForControlledWork && !hasCurrentGoal(ctx, agent)) return { kind: 'deny', reason: 'controlled work requires an active durable goal' }
  if (mutation && !effectiveAllow(contract.requestedAuthority.mutation, config.allowMutation)) return { kind: 'deny', reason: 'mutation authority was not granted by both contract and deployment policy' }
  if (network && !effectiveAllow(contract.requestedAuthority.network, config.allowNetwork)) return { kind: 'deny', reason: 'network authority was not granted by both contract and deployment policy' }
  if (irreversible && !config.allowIrreversible) return { kind: 'deny', reason: 'deployment policy forbids irreversible actions' }
  if (irreversible && contract.requestedAuthority.irreversible !== true) return { kind: 'ask', reason: 'Goal Contract did not pre-authorize this irreversible action' }
  return { kind: 'allow' }
}

const verifiedControlStateSchema = zod.object({
  contract: zod.unknown().nullable(),
  facts: zod.record(zod.string(), zod.unknown()),
  openTransactions: zod.record(zod.string(), zod.unknown()),
  externalEffects: zod.record(zod.string(), zod.unknown()),
  incidents: zod.array(zod.unknown()),
  toolCalls: zod.number().int().nonnegative(),
  failures: zod.number().int().nonnegative(),
  delegations: zod.number().int().nonnegative(),
  successfulTools: zod.number().int().nonnegative(),
  consecutiveFailures: zod.number().int().nonnegative(),
  lastTool: zod.object({ signature: zod.string().nullable(), repeated: zod.number().int().nonnegative() }),
  startedAt: zod.number().nullable(),
  recoveries: zod.number().int().nonnegative(),
}) as unknown as ZodType<VerifiedControlState>

export const verifiedControlProjection = {
  key: 'verified-control', stateSchema: verifiedControlStateSchema,
  init: (): VerifiedControlState => structuredClone(EMPTY_CONTROL_STATE),
  apply: (state: VerifiedControlState, event: SessionEvent) => applyVerifiedControlEvent(state, event),
  stateVersion: 2,
} satisfies ProjectionDefinition<'verified-control', VerifiedControlState>

export function setContract(agent: Agent, contract: GoalContract, replace = false): void {
  appendState(agent, current => {
    if (!replace && current.contract !== null) throw new Error('Goal Contract is already set; use control_amend_contract with human approval')
    return { ...current, contract: structuredClone(contract), startedAt: current.startedAt ?? Date.now() }
  })
}

function factFromArgs(args: { key: string; value: JsonValue; source?: string; confidence?: number; ttl_ms?: number; dependencies?: string[] }): TrustedFact {
  if (args.key.trim().length === 0) throw new TypeError('fact key must be non-empty')
  const confidence = args.confidence ?? 0.5
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError('confidence must be between 0 and 1')
  if (args.ttl_ms !== undefined && (!Number.isSafeInteger(args.ttl_ms) || args.ttl_ms < 1)) throw new TypeError('ttl_ms must be a positive safe integer')
  const observedAt = Date.now()
  return { key: args.key, value: args.value, origin: 'model', source: `model:${args.source ?? 'observation'}`, confidence, observedAt, ...(args.ttl_ms === undefined ? {} : { validUntil: observedAt + args.ttl_ms }), verifiedBy: [], dependencies: args.dependencies ?? [], valid: true }
}

export function apply(ctx: Context, input: Config = {}): void {
  const config: ResolvedConfig = {
    enforceWithoutContract: input.enforceWithoutContract ?? true,
    requireGoalForControlledWork: input.requireGoalForControlledWork ?? true,
    allowMutation: input.allowMutation ?? true,
    allowNetwork: input.allowNetwork ?? false,
    allowIrreversible: input.allowIrreversible ?? false,
    maxToolCalls: input.maxToolCalls ?? 512,
    maxFailures: input.maxFailures ?? 32,
    maxDurationMs: input.maxDurationMs ?? 86_400_000,
    maxRepeatedToolCalls: input.maxRepeatedToolCalls ?? 8,
    mutationTools: input.mutationTools ?? ['write', 'edit'],
    networkTools: input.networkTools ?? ['web_search', 'web_fetch'],
    irreversibleTools: input.irreversibleTools ?? [],
  }
  ctx.sessionProjections.register(verifiedControlProjection)

  const jsonOutput = { schema: {}, render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
  ctx.tools.register(defineTool({
    name: 'control_set_contract', description: 'Set the immutable durable Goal Contract for the current goal. Deployment policy can only reduce requested authority and budgets.', parameters: { contract: { type: 'json', required: true } }, output: jsonOutput,
    execute(args, exec) { if (exec.agent === undefined) throw new Error('control_set_contract requires an agent'); if (config.requireGoalForControlledWork && !hasCurrentGoal(ctx, exec.agent)) throw new Error('create a durable goal before setting its Goal Contract'); const contract = parseContract(args.contract); setContract(exec.agent, contract); return Promise.resolve({ accepted: true, objective: contract.objective }) },
  }))
  ctx.tools.register(defineTool({
    name: 'control_amend_contract', description: 'Replace the current Goal Contract only after explicit human approval for a genuine scope change.', parameters: { contract: { type: 'json', required: true } }, output: jsonOutput,
    execute(args, exec) { if (exec.agent === undefined) throw new Error('control_amend_contract requires an agent'); const contract = parseContract(args.contract); setContract(exec.agent, contract, true); return Promise.resolve({ accepted: true, objective: contract.objective }) },
  }))
  ctx.tools.register(defineTool({
    name: 'control_observe_fact', description: 'Record a model observation in durable World State. This does not certify the fact; verifiedBy remains empty until independent attestation or verification.', parameters: { key: { type: 'string', required: true }, value: { type: 'json', required: true }, source: { type: 'string' }, confidence: { type: 'number' }, ttl_ms: { type: 'integer' }, dependencies: { type: 'array', items: { type: 'string' } } }, output: jsonOutput,
    execute(args, exec) { if (exec.agent === undefined) throw new Error('control_observe_fact requires an agent'); const fact = factFromArgs(args); appendState(exec.agent, state => putFact(state, fact)); return Promise.resolve({ recorded: true, key: fact.key, certified: false }) },
  }))
  ctx.tools.register(defineTool({
    name: 'control_attest_fact', description: 'Human-attest an existing World State fact. The policy always asks for explicit approval before this tool executes.', parameters: { key: { type: 'string', required: true } }, output: jsonOutput,
    execute(args, exec) { if (exec.agent === undefined) throw new Error('control_attest_fact requires an agent'); appendState(exec.agent, state => attestFact(state, args.key, 'human')); return Promise.resolve({ attested: true, key: args.key }) },
  }))
  ctx.tools.register(defineTool({
    name: 'control_verify_fact', description: 'Certify an existing fact only after an independent deterministic verifier passes.', parameters: { key: { type: 'string', required: true }, verifier: { type: 'json', required: true } }, output: jsonOutput,
    async execute(args, exec) { if (exec.agent === undefined) throw new Error('control_verify_fact requires an agent'); const state = stateOf(ctx, exec.agent); const fact = state.facts[args.key]; if (fact === undefined || !fact.valid) throw new Error(`fact ${args.key} is missing or invalid`); const spec = parseVerificationSpec(args.verifier); if (spec.kind === 'fact_equals') throw new Error('control_verify_fact cannot certify a fact by asking that same fact to verify itself'); const result = await verifySpec(ctx, state, spec, exec.signal); if (!result.passed) throw new Error(`independent verifier failed: ${result.reason}`); appendState(exec.agent, current => attestFact(current, args.key, `verifier:${spec.kind}`)); return { verified: true, key: args.key, by: spec.kind } },
  }))
  ctx.tools.register(defineTool({
    name: 'control_invalidate_fact', description: 'Invalidate a World State fact and all dependent facts.', parameters: { key: { type: 'string', required: true } }, output: jsonOutput,
    execute(args, exec) { if (exec.agent === undefined) throw new Error('control_invalidate_fact requires an agent'); appendState(exec.agent, state => invalidateFact(state, args.key)); return Promise.resolve({ invalidated: true, key: args.key }) },
  }))
  ctx.tools.register(defineTool({
    name: 'control_get_state', description: 'Read the durable verified-control state, including freshness-aware facts, incidents, open transactions and external reviews.', parameters: {}, output: jsonOutput,
    execute(_args, exec) { if (exec.agent === undefined) throw new Error('control_get_state requires an agent'); const state = stateOf(ctx, exec.agent); return Promise.resolve({ contract: state.contract, facts: validFacts(state), openTransactions: state.openTransactions, externalEffects: state.externalEffects, incidents: state.incidents, budgets: { toolCalls: state.toolCalls, failures: state.failures }, trajectory: { consecutiveFailures: state.consecutiveFailures, repeatedToolCalls: state.lastTool.repeated, recoveries: state.recoveries } }) },
  }))

  ctx.on('tools/pre-execute', async (exec, next) => {
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    const base = preToolDecision(ctx, config, exec)
    if (base.kind !== 'allow') return base
    if (exec.agent === undefined) return base
    const state = stateOf(ctx, exec.agent)
    const mutation = config.mutationTools.includes(exec.name)
    if (mutation && state.contract !== null && state.contract.invariants.length > 0) {
      const invariantVerification = await verifyChecks(ctx, state, state.contract.invariants, exec.signal)
      if (!invariantVerification.passed) {
        const failed = invariantVerification.results.filter(result => !result.passed).map(result => `${result.description}: ${result.reason}`).join('; ')
        return { kind: 'deny', reason: `mutation blocked because Goal Contract invariants are not independently verified: ${failed}` }
      }
    }
    if (exec.name === 'update_goal' && typeof exec.arguments === 'object' && exec.arguments !== null && (exec.arguments as Record<string, unknown>).action === 'complete') {
      if (state.contract === null) return { kind: 'deny', reason: 'goal completion requires a Goal Contract' }
      const invariantVerification = await verifyChecks(ctx, state, state.contract.invariants, exec.signal)
      if (!invariantVerification.passed) return { kind: 'deny', reason: `Goal Contract invariant verification failed: ${invariantVerification.results.filter(result => !result.passed).map(result => `${result.description}: ${result.reason}`).join('; ')}` }
      const completion = await verifyChecks(ctx, state, state.contract.success, exec.signal)
      if (!completion.passed) return { kind: 'deny', reason: `Goal Contract completion verification failed (coverage ${Math.round(completion.coverage * 100)}%): ${completion.results.filter(result => !result.passed).map(result => `${result.description}: ${result.reason}`).join('; ')}` }
    }
    return base
  })
}
