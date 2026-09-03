import type { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { stateOf } from './runtime-state.ts'
import type { VerifiedControlState } from './types.ts'

export interface EffortConfig { enabled: boolean; baseline: string; elevated: string; critical: string; failureThreshold: number; criticalFailureThreshold: number; repetitionThreshold: number }

export function chooseReasoningEffort(state: VerifiedControlState, config: EffortConfig): string {
  const recoveryRisk = Object.values(state.externalEffects).some(effect => effect.status === 'open' || effect.status === 'review') || Object.values(state.openTransactions).some(tx => tx.status === 'rollback-failed')
  if (recoveryRisk || state.consecutiveFailures >= config.criticalFailureThreshold) return config.critical
  if (state.consecutiveFailures >= config.failureThreshold || state.lastTool.repeated >= config.repetitionThreshold) return config.elevated
  return config.baseline
}

export function installAdaptiveEffort(ctx: Context, config: EffortConfig): void {
  if (!config.enabled) return
  ctx.on('agent/request', async ({ agent }, next) => {
    const resolved = await next()
    return { ...resolved, reasoningEffort: ReasoningEffortId(chooseReasoningEffort(stateOf(ctx, agent), config)) }
  })
}
