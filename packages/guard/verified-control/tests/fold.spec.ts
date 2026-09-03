import { describe, expect, it } from 'vitest'
import { applyVerifiedControlEvent, validFacts } from '../src/fold.ts'
import { EMPTY_CONTROL_STATE } from '../src/types.ts'

describe('verified-control fold', () => {
  it('filters expired facts from the planner-facing snapshot', () => {
    const state = {
      ...EMPTY_CONTROL_STATE,
      facts: {
        fresh: { key: 'fresh', value: 1, source: 'test', confidence: 1, observedAt: 10, validUntil: 100, verifiedBy: ['test'], dependencies: [], valid: true },
        stale: { key: 'stale', value: 2, source: 'test', confidence: 1, observedAt: 10, validUntil: 20, verifiedBy: ['test'], dependencies: [], valid: true },
      },
    }
    expect(validFacts(state, 50)).toEqual({ fresh: 1 })
  })

  it('counts durable tool errors from tool_result.isError', () => {
    const event = {
      type: 'tool/result',
      data: { message: { content: [{ type: 'tool_result', toolCallId: 'x', content: [], isError: true }] } },
    } as any
    const next = applyVerifiedControlEvent(EMPTY_CONTROL_STATE, event)
    expect(next.toolCalls).toBe(1)
    expect(next.failures).toBe(1)
  })
})
