import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { applyVerifiedControlEvent } from './fold.ts'
import { registerControlTools } from './control-tools.ts'
import { installPreExecutePolicy, type PolicyConfig } from './policy.ts'
import { installTransactionRuntime } from './transaction-runtime.ts'
import { installExternalEffectRuntime } from './external-effect-runtime.ts'
import { EMPTY_CONTROL_STATE, type VerifiedControlState } from './types.ts'

export * from './types.ts'
export * from './fold.ts'
export * from './state.ts'
export * from './transaction.ts'
export * from './verifier.ts'
export * from './contract.ts'

export const name = 'verified-control'
export const inject = ['fs', 'goals', 'sessionProjections', 'tools']

declare module '@deepseek-ai/dsh-session' { interface SessionEventMap { 'verified-control/snapshot': { state: VerifiedControlState } } }
declare module '@deepseek-ai/dsh-session-projection' { interface SessionProjectionStateMap { 'verified-control': VerifiedControlState } }

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
  cleanupTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  enforceWithoutContract: z.boolean().default(true), requireGoalForControlledWork: z.boolean().default(true), allowMutation: z.boolean().default(true), allowNetwork: z.boolean().default(false), allowIrreversible: z.boolean().default(false), maxToolCalls: z.number().step(1).min(1).default(512), maxFailures: z.number().step(1).min(0).default(32), maxDurationMs: z.number().step(1).min(1).default(86_400_000), maxRepeatedToolCalls: z.number().step(1).min(1).default(8), mutationTools: z.array(z.string()).default(['write', 'edit']), networkTools: z.array(z.string()).default(['web_search', 'web_fetch']), irreversibleTools: z.array(z.string()).default([]), cleanupTimeoutMs: z.number().step(1).min(1).default(10_000),
})

const stateSchema = zod.object({ contract: zod.unknown().nullable(), facts: zod.record(zod.string(), zod.unknown()), openTransactions: zod.record(zod.string(), zod.unknown()), externalEffects: zod.record(zod.string(), zod.unknown()), incidents: zod.array(zod.unknown()), toolCalls: zod.number().int().nonnegative(), failures: zod.number().int().nonnegative(), delegations: zod.number().int().nonnegative(), successfulTools: zod.number().int().nonnegative(), consecutiveFailures: zod.number().int().nonnegative(), lastTool: zod.object({ signature: zod.string().nullable(), repeated: zod.number().int().nonnegative() }), startedAt: zod.number().nullable(), recoveries: zod.number().int().nonnegative() }) as unknown as ZodType<VerifiedControlState>

export const verifiedControlProjection = { key: 'verified-control', stateSchema, init: (): VerifiedControlState => structuredClone(EMPTY_CONTROL_STATE), apply: (state: VerifiedControlState, event: SessionEvent) => applyVerifiedControlEvent(state, event), stateVersion: 3 } satisfies ProjectionDefinition<'verified-control', VerifiedControlState>

export function apply(ctx: Context, input: Config = {}): void {
  const policy: PolicyConfig = { enforceWithoutContract: input.enforceWithoutContract ?? true, requireGoalForControlledWork: input.requireGoalForControlledWork ?? true, allowMutation: input.allowMutation ?? true, allowNetwork: input.allowNetwork ?? false, allowIrreversible: input.allowIrreversible ?? false, maxToolCalls: input.maxToolCalls ?? 512, maxFailures: input.maxFailures ?? 32, maxDurationMs: input.maxDurationMs ?? 86_400_000, maxRepeatedToolCalls: input.maxRepeatedToolCalls ?? 8, mutationTools: input.mutationTools ?? ['write', 'edit'], networkTools: input.networkTools ?? ['web_search', 'web_fetch'], irreversibleTools: input.irreversibleTools ?? [] }
  for (const tool of policy.irreversibleTools) {
    if (policy.mutationTools.includes(tool)) throw new Error(`verified-control: tool ${tool} cannot be both transactional mutation and irreversible external effect`)
  }
  ctx.sessionProjections.register(verifiedControlProjection)
  registerControlTools(ctx, policy.requireGoalForControlledWork)
  installPreExecutePolicy(ctx, policy)
  installTransactionRuntime(ctx, { mutationTools: policy.mutationTools, cleanupTimeoutMs: input.cleanupTimeoutMs ?? 10_000 })
  installExternalEffectRuntime(ctx, { irreversibleTools: policy.irreversibleTools })
}
