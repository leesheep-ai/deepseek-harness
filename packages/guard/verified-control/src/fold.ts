import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { EMPTY_CONTROL_STATE, type VerifiedControlState } from './types.ts'

export interface VerifiedControlSnapshot {
  state: VerifiedControlState
}

export function applyVerifiedControlEvent(
  previous: VerifiedControlState = EMPTY_CONTROL_STATE,
  event: SessionEvent,
): VerifiedControlState {
  switch (event.type) {
    case 'verified-control/snapshot':
      return event.data.state
    case 'tool/result': {
      const block = event.data.message.content[0]
      const isError = block?.type === 'tool_result' && block.isError === true
      return {
        ...previous,
        toolCalls: previous.toolCalls + 1,
        failures: previous.failures + (isError ? 1 : 0),
      }
    }
    default:
      return previous
  }
}

export function validFacts(state: VerifiedControlState, now = Date.now()): Record<string, unknown> {
  return Object.fromEntries(Object.values(state.facts)
    .filter(fact => fact.valid && (fact.validUntil === undefined || fact.validUntil > now))
    .map(fact => [fact.key, fact.value]))
}
