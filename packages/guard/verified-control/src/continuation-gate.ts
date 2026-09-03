import type { Context } from '@deepseek-ai/cordis'
import type { GoalBlockReason, GoalRef } from '@deepseek-ai/dsh-goal'
import type { PolicyConfig } from './policy.ts'
import { stateOf } from './runtime-state.ts'
import type { VerifiedControlState } from './types.ts'

function maxFor(requested: number | undefined, platform: number): number {
  return Math.min(requested ?? platform, platform)
}

function unresolvedExternalReview(state: VerifiedControlState): boolean {
  return Object.values(state.externalEffects).some(effect => effect.status === 'open' || effect.status === 'review')
}

function unresolvedTransaction(state: VerifiedControlState): boolean {
  return Object.values(state.openTransactions).some(tx => tx.status === 'rollback-failed')
}

/**
 * Return the hard condition that makes another autonomous goal round useless
 * or unsafe. This mirrors policy limits but is evaluated at the turn boundary,
 * where the goal driver can be stopped without bypassing its round accounting.
 */
export function continuationBlocker(
  state: VerifiedControlState,
  config: PolicyConfig,
  now = Date.now(),
): GoalBlockReason | undefined {
  if (unresolvedExternalReview(state)) {
    return {
      code: 'external-effect-review',
      message: 'Verified control requires human reconciliation of an unresolved external effect before autonomous continuation.',
    }
  }
  if (unresolvedTransaction(state)) {
    return {
      code: 'rollback-failed',
      message: 'Verified control requires reconciliation of a failed rollback before autonomous continuation.',
    }
  }

  const contract = state.contract
  if (state.toolCalls >= maxFor(contract?.requestedBudget.maxToolCalls, config.maxToolCalls)) {
    return {
      code: 'tool-call-budget',
      message: 'Verified-control tool-call budget is exhausted; autonomous continuation is blocked.',
    }
  }
  if (state.failures >= maxFor(contract?.requestedBudget.maxFailures, config.maxFailures)) {
    return {
      code: 'failure-budget',
      message: 'Verified-control failure budget is exhausted; autonomous continuation is blocked.',
    }
  }
  if (contract !== null && state.startedAt !== null
    && now - state.startedAt >= maxFor(contract.requestedBudget.maxDurationMs, config.maxDurationMs)) {
    return {
      code: 'duration-budget',
      message: 'Verified-control duration budget is exhausted; autonomous continuation is blocked.',
    }
  }
  if (state.lastTool.repeated > maxFor(contract?.requestedBudget.maxRepeatedToolCalls, config.maxRepeatedToolCalls)) {
    return {
      code: 'repetition-stall',
      message: 'Verified control detected a repeated-tool stall; autonomous continuation is blocked until the strategy changes.',
    }
  }
  return undefined
}

/**
 * Convert verified-control hard stops into the native goal lifecycle before
 * the current turn closes. The existing goal-round driver then observes the
 * blocked phase and does not enqueue another round.
 */
export function installContinuationGate(ctx: Context, config: PolicyConfig): void {
  ctx.on('agent/turn-stopping', ({ agent }) => {
    const blocker = continuationBlocker(stateOf(ctx, agent), config)
    if (blocker === undefined) return

    let goal
    try {
      goal = ctx.goals.get(agent)
    } catch (error: unknown) {
      ctx.logger.warn(`verified-control: could not read goal at continuation gate: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (goal === undefined || goal.phase !== 'active' || goal.activation !== 'armed') return

    const ref: GoalRef = { id: goal.id, revision: goal.revision }
    try {
      ctx.goals.block(agent, ref, blocker)
    } catch (error: unknown) {
      ctx.logger.warn(`verified-control: could not block autonomous continuation: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
