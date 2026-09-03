import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { appendState, stateOf } from './runtime-state.ts'
import type { ExternalEffect, Incident, VerifiedControlState } from './types.ts'

export interface ExternalEffectRuntimeConfig {
  irreversibleTools: readonly string[]
}

function incident(message: string, tool: string): Incident {
  return {
    id: `external-effect-review:${randomUUID()}`,
    kind: 'external-effect-review',
    message,
    createdAt: Date.now(),
    tool,
    regressionEval: {
      name: 'regression:external-effect-review',
      assertion: `External side effects must never be assumed rolled back after uncertainty: ${message}`,
    },
  }
}

function openEffect(agent: Agent, tool: string, callId: string): ExternalEffect {
  const effect: ExternalEffect = {
    id: randomUUID(),
    tool,
    callId,
    openedAt: Date.now(),
    status: 'open',
  }
  appendState(agent, state => ({
    ...state,
    externalEffects: { ...state.externalEffects, [effect.id]: effect },
  }))
  return effect
}

function resolveEffect(agent: Agent, id: string): void {
  appendState(agent, state => {
    const effect = state.externalEffects[id]
    if (effect === undefined) return state
    return {
      ...state,
      externalEffects: {
        ...state.externalEffects,
        [id]: { ...effect, status: 'resolved', resolution: 'confirmed' },
      },
    }
  })
}

function reviewEffect(agent: Agent, id: string, detail: string): void {
  appendState(agent, state => {
    const effect = state.externalEffects[id]
    if (effect === undefined || effect.status === 'resolved') return state
    const reviewed = { ...effect, status: 'review' as const, detail }
    return {
      ...state,
      externalEffects: { ...state.externalEffects, [id]: reviewed },
      incidents: [...state.incidents, incident(detail, effect.tool)],
    }
  })
}

export function reconcileExternalEffect(
  state: VerifiedControlState,
  id: string,
  resolution: 'confirmed' | 'not-applied' | 'compensated',
  detail?: string,
): VerifiedControlState {
  const effect = state.externalEffects[id]
  if (effect === undefined) throw new Error(`external effect ${id} does not exist`)
  if (effect.status === 'resolved') throw new Error(`external effect ${id} is already resolved`)
  return {
    ...state,
    externalEffects: {
      ...state.externalEffects,
      [id]: {
        ...effect,
        status: 'resolved',
        resolution,
        ...(detail === undefined || detail.length === 0 ? {} : { detail }),
      },
    },
  }
}

export function promoteCrashOrphansToReview(state: VerifiedControlState): VerifiedControlState {
  let changed = false
  const externalEffects = { ...state.externalEffects }
  const incidents = [...state.incidents]
  for (const [id, effect] of Object.entries(externalEffects)) {
    if (effect.status !== 'open') continue
    changed = true
    const detail = 'process resumed with an external side effect still open; whether it applied is unknown'
    externalEffects[id] = { ...effect, status: 'review', detail }
    incidents.push(incident(detail, effect.tool))
  }
  return changed ? { ...state, externalEffects, incidents } : state
}

export function installExternalEffectRuntime(ctx: Context, config: ExternalEffectRuntimeConfig): void {
  if (config.irreversibleTools.length === 0) return

  ctx.on('agent/pre-step', async (payload, next) => {
    const before = stateOf(ctx, payload.agent)
    const after = promoteCrashOrphansToReview(before)
    if (after !== before) appendState(payload.agent, () => after)
    return next()
  })

  ctx.on('tools/execute', async (exec, next) => {
    if (exec.agent === undefined || !config.irreversibleTools.includes(exec.name)) return next()
    const effect = openEffect(exec.agent, exec.name, String(exec.callId))
    let result: ToolExecutionResult
    try {
      result = await next()
    } catch (error: unknown) {
      reviewEffect(exec.agent, effect.id, error instanceof Error ? error.message : String(error))
      throw error
    }
    if (result.isError) {
      reviewEffect(exec.agent, effect.id, result.error.message)
    } else {
      resolveEffect(exec.agent, effect.id)
    }
    return result
  })
}
