import type { Context } from '@deepseek-ai/cordis'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { LlmError, type Message } from '@deepseek-ai/dsh-llm'
import {
  deriveEventMessage,
  foldRequestHeader,
  foldSurface,
  SessionSeq,
  type EpochHeader,
  type Session,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import { renderPrompt, type PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { isFable51Model } from './prompt.ts'

interface FableThinkingBinding {
  readonly messageId: string
  readonly header: EpochHeader
  readonly historicalPrefixIds: readonly string[]
  readonly currentPrefixIds: readonly string[]
}

/**
 * Claude model ids that Fable 5.1 may accept preserved thinking from. Official
 * Claude API, Bedrock, and Vertex-style ids all retain a `claude-` segment.
 */
export function isClaudeThinkingSourceForFable51(model: string | undefined): boolean {
  if (model === undefined) return false
  return /(?:^|[./:])claude-/.test(model.trim().toLowerCase())
}

function hasPiAiReasoningReplay(message: Message): boolean {
  const source = message.source
  if (source.kind !== 'model' || source.replayState === undefined) return false
  const state = source.replayState
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return false
  const envelope = state as Record<string, unknown>
  const response = envelope['response']
  const blocks = envelope['blocks']
  return typeof response === 'object'
    && response !== null
    && !Array.isArray(response)
    && (response as Record<string, unknown>)['kind'] === 'pi-ai'
    && Array.isArray(blocks)
    && blocks.some(block => typeof block === 'object'
      && block !== null
      && !Array.isArray(block)
      && (block as Record<string, unknown>)['type'] === 'reasoning')
}

function hasReplayBoundFableThinking(message: Message): boolean {
  const source = message.source
  return message.role === 'assistant'
    && source.kind === 'model'
    && isClaudeThinkingSourceForFable51(source.model)
    && message.content.some(block => block.type === 'reasoning')
    && hasPiAiReasoningReplay(message)
}

function eventSnapshotThrough(session: Session, end: SessionSeq): SessionEvent[] {
  const events: SessionEvent[] = []
  for (let index = 0; index <= end; index += 1) {
    const event = session.eventAt(SessionSeq(index))
    if (event === undefined) throw new Error(`verified-control: session event ${index} disappeared during Fable prefix inspection`)
    events.push(event)
  }
  return events
}

function assistantEventSeq(session: Session, messageId: string): SessionSeq | undefined {
  for (let index = session.seq - 1; index >= 0; index -= 1) {
    const event = session.eventAt(SessionSeq(index))
    if (event?.type === 'assistant/message' && event.data.message.id === messageId) return event.seq
  }
  return undefined
}

function prefixIdsAt(events: readonly SessionEvent[], boundSeq: SessionSeq): string[] {
  const surface = foldSurface(events).nodes
  const boundIndex = surface.indexOf(boundSeq)
  if (boundIndex < 0) throw new Error(`verified-control: bound Claude thinking event ${boundSeq} was not on its historical surface`)
  const ids: string[] = []
  for (const seq of surface.slice(0, boundIndex)) {
    const event = events[seq]
    if (event === undefined) throw new Error(`verified-control: historical surface references missing event ${seq}`)
    const message = deriveEventMessage(event)
    if (message !== null) ids.push(message.id)
  }
  return ids
}

function latestBinding(agent: Agent): FableThinkingBinding | undefined {
  const current = agent.session.deriveMessages()
  for (let index = current.length - 1; index >= 0; index -= 1) {
    const message = current[index]
    if (message === undefined || !hasReplayBoundFableThinking(message)) continue
    const seq = assistantEventSeq(agent.session, message.id)
    if (seq === undefined) throw new Error(`verified-control: retained Claude thinking message ${message.id} has no session event`)
    const events = eventSnapshotThrough(agent.session, seq)
    const header = foldRequestHeader(events)
    if (header === undefined) throw new Error(`verified-control: Claude thinking message ${message.id} has no durable request header`)
    return {
      messageId: message.id,
      header,
      historicalPrefixIds: prefixIdsAt(events, seq),
      currentPrefixIds: current.slice(0, index).map(item => item.id),
    }
  }
  return undefined
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function sameTools(left: EpochHeader['tools'], right: PromptAssembly['tools']): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right)
}

/**
 * Explain why replaying the latest retained Claude thinking block accepted by
 * Fable 5.1 would violate prefix binding, or return undefined when intact.
 */
export function fablePrefixMismatchReason(agent: Agent, assembly: PromptAssembly): string | undefined {
  const binding = latestBinding(agent)
  if (binding === undefined) return undefined
  if (!sameIds(binding.historicalPrefixIds, binding.currentPrefixIds)) {
    return `model-visible messages before Claude thinking block ${binding.messageId} changed after that block was produced`
  }
  const currentSystem = renderPrompt(assembly)
  if ((binding.header.system ?? '') !== currentSystem) {
    return `system prompt changed after Claude thinking block ${binding.messageId} was produced`
  }
  if (!sameTools(binding.header.tools, assembly.tools)) {
    return `tool definitions changed after Claude thinking block ${binding.messageId} was produced`
  }
  return undefined
}

function blockGoal(ctx: Context, agent: Agent, detail: string): void {
  try {
    const goal = ctx.goals.get(agent)
    if (goal === undefined || goal.phase !== 'active') return
    ctx.goals.block(agent, { id: goal.id, revision: goal.revision }, {
      code: 'fable-prefix-mismatch',
      message: `Claude Fable 5.1 thinking prefix binding would be invalid: ${detail}`,
    })
  } catch (error: unknown) {
    ctx.logger.warn(`verified-control: could not block goal after Fable prefix mismatch: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Fail before provider dispatch when a retained Claude thinking block that
 * Fable 5.1 can consume would be replayed under a changed system/tool/message
 * prefix. The guard observes the final request route from downstream request
 * middleware, then independently reassembles the prompt surface because the
 * core request event deliberately exposes configuration rather than mutable
 * message content.
 */
export function installFablePrefixGuard(ctx: Context): void {
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    if (!isFable51Model(config.model)) return config
    if (!agentHasReplayBoundFableThinking(payload.agent)) return config

    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(payload.agent, payload.signal))
    payload.signal.throwIfAborted()
    const mismatch = fablePrefixMismatchReason(payload.agent, assembly)
    if (mismatch === undefined) return config

    blockGoal(ctx, payload.agent, mismatch)
    throw new LlmError(
      `verified-control blocked Claude Fable 5.1 request: ${mismatch}. Start a fresh conversation or compact the bound thinking block out of retained history before changing its prefix.`,
      'FABLE_PREFIX_MISMATCH',
    )
  })
}

/**
 * Cheap preflight used to avoid a second prompt assembly before retained
 * provider-native Claude reasoning can be replayed into Fable 5.1.
 */
export function agentHasReplayBoundFableThinking(agent: Agent): boolean {
  return agent.session.deriveMessages().some(hasReplayBoundFableThinking)
}
