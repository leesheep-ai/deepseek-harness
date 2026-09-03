import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution, PreToolDecision } from '@deepseek-ai/dsh-tools'
import { hasCurrentGoal, stateOf } from './runtime-state.ts'
import { verifyChecks } from './verifier.ts'
import type { VerifiedControlState } from './types.ts'

export interface PolicyConfig {
  enforceWithoutContract: boolean
  requireGoalForControlledWork: boolean
  allowMutation: boolean
  allowNetwork: boolean
  allowIrreversible: boolean
  maxToolCalls: number
  maxFailures: number
  maxDurationMs: number
  maxRepeatedToolCalls: number
  mutationTools: string[]
  networkTools: string[]
  irreversibleTools: string[]
}

function maxFor(requested: number | undefined, platform: number): number { return Math.min(requested ?? platform, platform) }
function unresolvedExternalReview(state: VerifiedControlState): boolean { return Object.values(state.externalEffects).some(effect => effect.status === 'open' || effect.status === 'review') }
function unresolvedTransaction(state: VerifiedControlState): boolean { return Object.values(state.openTransactions).some(tx => tx.status === 'rollback-failed') }

export function baseToolDecision(ctx: Context, config: PolicyConfig, exec: ToolExecution): PreToolDecision {
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
  if (mutation && !(contract.requestedAuthority.mutation && config.allowMutation)) return { kind: 'deny', reason: 'mutation authority was not granted by both contract and deployment policy' }
  if (network && !(contract.requestedAuthority.network && config.allowNetwork)) return { kind: 'deny', reason: 'network authority was not granted by both contract and deployment policy' }
  if (irreversible && !config.allowIrreversible) return { kind: 'deny', reason: 'deployment policy forbids irreversible actions' }
  if (irreversible && contract.requestedAuthority.irreversible !== true) return { kind: 'ask', reason: 'Goal Contract did not pre-authorize this irreversible action' }
  return { kind: 'allow' }
}

export function installPreExecutePolicy(ctx: Context, config: PolicyConfig): void {
  ctx.on('tools/pre-execute', async (exec, next) => {
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    const base = baseToolDecision(ctx, config, exec)
    if (base.kind !== 'allow' || exec.agent === undefined) return base
    const state = stateOf(ctx, exec.agent)
    if (config.mutationTools.includes(exec.name) && state.contract !== null && state.contract.invariants.length > 0) {
      const verification = await verifyChecks(ctx, state, state.contract.invariants, exec.signal)
      if (!verification.passed) return { kind: 'deny', reason: `mutation blocked because Goal Contract invariants are not independently verified: ${verification.results.filter(item => !item.passed).map(item => `${item.description}: ${item.reason}`).join('; ')}` }
    }
    if (exec.name === 'update_goal' && typeof exec.arguments === 'object' && exec.arguments !== null && (exec.arguments as Record<string, unknown>).action === 'complete') {
      if (state.contract === null) return { kind: 'deny', reason: 'goal completion requires a Goal Contract' }
      const invariants = await verifyChecks(ctx, state, state.contract.invariants, exec.signal)
      if (!invariants.passed) return { kind: 'deny', reason: `Goal Contract invariant verification failed: ${invariants.results.filter(item => !item.passed).map(item => `${item.description}: ${item.reason}`).join('; ')}` }
      const success = await verifyChecks(ctx, state, state.contract.success, exec.signal)
      if (!success.passed) return { kind: 'deny', reason: `Goal Contract completion verification failed (coverage ${Math.round(success.coverage * 100)}%): ${success.results.filter(item => !item.passed).map(item => `${item.description}: ${item.reason}`).join('; ')}` }
    }
    return base
  })
}
