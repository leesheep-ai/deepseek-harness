import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { EMPTY_CONTROL_STATE, type Incident, type VerifiedControlState } from './types.ts'
import { publicFactValues } from './state.ts'

export interface VerifiedControlSnapshot {
  state: VerifiedControlState
}

function stableToolSignature(name: string, args: string): string {
  return `${name}:${args}`
}

function incident(kind: Incident['kind'], message: string, event: SessionEvent): Incident {
  const callId = event.type === 'tool/result' ? event.data.message.source.callId : undefined
  return {
    id: `${kind}:${String(callId ?? event.seq)}:${event.time}`,
    kind,
    message,
    createdAt: event.time,
    ...(callId === undefined ? {} : { callId: String(callId) }),
    regressionEval: { name: `regression:${kind}`, assertion: `This trajectory must not reproduce: ${message}` },
  }
}

export function applyVerifiedControlEvent(
  previous: VerifiedControlState = EMPTY_CONTROL_STATE,
  event: SessionEvent,
): VerifiedControlState {
  switch (event.type) {
    case 'verified-control/snapshot':
      return event.data.state
    case 'tool/call': {
      const signature = stableToolSignature(event.data.name, event.data.arguments)
      return {
        ...previous,
        lastTool: {
          signature,
          repeated: previous.lastTool.signature === signature ? previous.lastTool.repeated + 1 : 1,
        },
      }
    }
    case 'tool/result': {
      const block = event.data.message.content[0]
      const isError = block?.type === 'tool-result' && block.isError === true
      return {
        ...previous,
        toolCalls: previous.toolCalls + 1,
        failures: previous.failures + (isError ? 1 : 0),
        successfulTools: previous.successfulTools + (isError ? 0 : 1),
        consecutiveFailures: isError ? previous.consecutiveFailures + 1 : 0,
        incidents: isError
          ? [...previous.incidents, incident('tool-failure', event.data.error?.code ?? 'tool call failed', event)]
          : previous.incidents,
      }
    }
    default:
      return previous
  }
}

export function validFacts(state: VerifiedControlState, now = Date.now()): Record<string, unknown> {
  return publicFactValues(state, now)
}
