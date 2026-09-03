import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution, PreToolDecision } from '@deepseek-ai/dsh-tools'
import { currentGoal, hasCurrentGoal, stateOf } from './runtime-state.ts'
import { verifyChecks } from './verifier.ts'
import type { VerifiedControlState } from './types.ts'
import { hasPreparedDelegation } from './delegation-runtime.ts'

export interface PolicyConfig {
  enforceWithoutContract: boolean
  requireGoalForControlledWork: boolean
  allowMutation: boolean
  allowNetwork: boolean
  allowIrreversible: boolean
  allowDelegation: boolean
  maxToolCalls: number
  maxFailures: number
  maxDurationMs: number
  maxRepeatedToolCalls: number
  maxDelegations: number
  mutationTools: string[]
  networkTools: string[]
  irreversibleTools: string[]
  delegationTools: string[]
}

function maxFor(requested: number | undefined, platform: number): number { return Math.min(requested ?? platform, platform) }
export function failureBudgetExhausted(failures: number, requested: number | undefined, platform: number): boolean {
  const limit = maxFor(requested, platform)
  return failures > 0 && failures >= limit
}
function unresolvedExternalReview(state: VerifiedControlState): boolean { return Object.values(state.externalEffects).some(effect => effect.status === 'open' || effect.status === 'review') }
function unresolvedRollback(state: VerifiedControlState): boolean { return Object.values(state.openTransactions).some(tx => tx.status === 'rollback-failed') }
function pendingTransaction(state: VerifiedControlState): boolean { return Object.keys(state.openTransactions).length > 0 }
function isGoalCompletion(exec: ToolExecution): boolean {
  return exec.name === 'update_goal'
    && typeof exec.arguments === 'object'
    && exec.arguments !== null
    && (exec.arguments as Record<string, unknown>).action === 'complete'
}

function contractBindingIssue(ctx: Context, exec: ToolExecution, state: VerifiedControlState): string | undefined {
  if (exec.agent === undefined || state.contract === null) return undefined
  const goal = currentGoal(ctx, exec.agent)
  if (goal === undefined) {
    return state.contractGoalId === null
      ? undefined
      : 'Goal Contract is bound to a durable goal that is no longer current; create or select the intended goal and set its contract'
  }
  if (goal.phase === 'complete') return 'Goal Contract cannot authorize work for an already completed goal'
  if (state.contractGoalId !== String(goal.id)) {
    return 'Goal Contract is not bound to the current durable goal; call control_set_contract for this goal before continuing'
  }
  if (state.contract.objective !== goal.objective) {
    return 'current durable goal objective differs from its Goal Contract; use control_amend_contract with human approval before continuing'
  }
  return undefined
}

export function baseToolDecision(ctx: Context, config: PolicyConfig, exec: ToolExecution): PreToolDecision {
  const agent = exec.agent
  if (agent === undefined) return { kind: 'allow' }
  const state = stateOf(ctx, agent)
  const contract = state.contract
  const mutation = config.mutationTools.includes(exec.name)
  const network = config.networkTools.includes(exec.name)
  const irreversible = config.irreversibleTools.includes(exec.name)
  const delegation = config.delegationTools.includes(exec.name)
  const controlled = mutation || network || irreversible || delegation
  const completing = isGoalCompletion(exec)

  if (exec.name === 'control_get_state' || exec.name === 'control_set_contract') return { kind: 'allow' }
  if (exec.name === 'control_attest_fact' || exec.name === 'control_amend_contract' || exec.name === 'control_reconcile_external_effect') return { kind: 'ask', reason: `${exec.name} requires explicit human approval` }

  if (completing) {
    if (contract === null) return { kind: 'deny', reason: 'goal completion requires a Goal Contract' }
    if (unresolvedExternalReview(state) || pendingTransaction(state)) {
      return { kind: 'deny', reason: 'goal completion is blocked until all transactions and external effects are reconciled' }
    }
    const bindingIssue = contractBindingIssue(ctx, exec, state)
    if (bindingIssue !== undefined) return { kind: 'deny', reason: bindingIssue }
    if (!hasCurrentGoal(ctx, agent)) return { kind: 'deny', reason: 'goal completion requires a current non-complete durable goal' }
    // Completion is a verified commit operation, not more operational work. It
    // remains available at the exact tool/failure/duration budget boundary so
    // a successfully finished goal cannot deadlock before committing complete.
    return { kind: 'allow' }
  }

  if ((unresolvedExternalReview(state) || unresolvedRollback(state)) && controlled) return { kind: 'deny', reason: 'verified-control recovery/reconciliation is required before more controlled work' }
  if (state.toolCalls >= maxFor(contract?.requestedBudget.maxToolCalls, config.maxToolCalls)) return { kind: 'deny', reason: 'verified-control tool-call budget exhausted' }
  if (failureBudgetExhausted(state.failures, contract?.requestedBudget.maxFailures, config.maxFailures)) return { kind: 'deny', reason: 'verified-control failure budget exhausted' }
  if (contract !== null && state.startedAt !== null && Date.now() - state.startedAt >= maxFor(contract.requestedBudget.maxDurationMs, config.maxDurationMs)) return { kind: 'deny', reason: 'verified-control duration budget exhausted' }
  if (state.lastTool.repeated > maxFor(contract?.requestedBudget.maxRepeatedToolCalls, config.maxRepeatedToolCalls)) return { kind: 'deny', reason: 'verified-control repeated-tool stall detected; change strategy before retrying' }
  if (delegation && state.delegations >= maxFor(contract?.requestedBudget.maxDelegations, config.maxDelegations)) return { kind: 'deny', reason: 'verified-control delegation budget exhausted' }
  if (!controlled) return { kind: 'allow' }
  if (contract === null) return config.enforceWithoutContract ? { kind: 'deny', reason: 'controlled work requires a Goal Contract' } : { kind: 'allow' }
  if (config.requireGoalForControlledWork && !hasCurrentGoal(ctx, agent)) return { kind: 'deny', reason: 'controlled work requires a current non-complete durable goal' }
  const bindingIssue = contractBindingIssue(ctx, exec, state)
  if (bindingIssue !== undefined) return { kind: 'deny', reason: bindingIssue }
  if (mutation && !(contract.requestedAuthority.mutation && config.allowMutation)) return { kind: 'deny', reason: 'mutation authority was not granted by both contract and deployment policy' }
  if (network && !(contract.requestedAuthority.network && config.allowNetwork)) return { kind: 'deny', reason: 'network authority was not granted by both contract and deployment policy' }
  if (irreversible && !config.allowIrreversible) return { kind: 'deny', reason: 'deployment policy forbids irreversible actions' }
  if (irreversible && contract.requestedAuthority.irreversible !== true) return { kind: 'ask', reason: 'Goal Contract did not pre-authorize this irreversible action' }
  if (delegation && !(contract.requestedAuthority.delegation === true && config.allowDelegation)) return { kind: 'deny', reason: 'delegation authority was not granted by both contract and deployment policy' }
  if (delegation && !hasPreparedDelegation(state)) return { kind: 'deny', reason: 'delegation requires control_prepare_delegation with objective, expected evidence, and resource scope' }
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
    if (isGoalCompletion(exec)) {
      if (state.contract === null) return { kind: 'deny', reason: 'goal completion requires a Goal Contract' }
      const invariants = await verifyChecks(ctx, state, state.contract.invariants, exec.signal)
      if (!invariants.passed) return { kind: 'deny', reason: `Goal Contract invariant verification failed: ${invariants.results.filter(item => !item.passed).map(item => `${item.description}: ${item.reason}`).join('; ')}` }
      const success = await verifyChecks(ctx, state, state.contract.success, exec.signal)
      if (!success.passed) return { kind: 'deny', reason: `Goal Contract completion verification failed (coverage ${Math.round(success.coverage * 100)}%): ${success.results.filter(item => !item.passed).map(item => `${item.description}: ${item.reason}`).join('; ')}` }
    }
    return base
  })
}
