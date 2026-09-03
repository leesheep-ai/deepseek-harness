import { describe, expect, it } from 'vitest'
import { applyVerifiedControlEvent, validFacts } from '../src/fold.ts'
import { EMPTY_CONTROL_STATE } from '../src/types.ts'

describe('verified-control fold', () => {
  it('filters expired facts from the current truth view', () => {
    const state = {
      ...EMPTY_CONTROL_STATE,
      facts: {
        fresh: { key: 'fresh', value: 1, origin: 'verifier' as const, source: 'test', confidence: 1, observedAt: 10, validUntil: 100, verifiedBy: ['test'], dependencies: [], valid: true },
        stale: { key: 'stale', value: 2, origin: 'verifier' as const, source: 'test', confidence: 1, observedAt: 10, validUntil: 20, verifiedBy: ['test'], dependencies: [], valid: true },
      },
    }
    expect(validFacts(state, 50)).toEqual({ fresh: 1 })
  })

  it('counts durable tool errors from the real tool-result block tag', () => {
    const event = {
      type: 'tool/result', seq: 1, time: 100,
      data: { message: { source: { kind: 'tool', callId: 'x' }, content: [{ type: 'tool-result', toolCallId: 'x', content: [], isError: true }] }, error: { code: 'TEST' } },
    } as any
    const next = applyVerifiedControlEvent(EMPTY_CONTROL_STATE, event)
    expect(next.toolCalls).toBe(1)
    expect(next.failures).toBe(1)
    expect(next.consecutiveFailures).toBe(1)
    expect(next.incidents).toHaveLength(1)
  })

  it('tracks repeated tool signatures', () => {
    const event = { type: 'tool/call', seq: 1, time: 100, data: { name: 'read', arguments: '{"file_path":"a"}' } } as any
    const once = applyVerifiedControlEvent(EMPTY_CONTROL_STATE, event)
    const twice = applyVerifiedControlEvent(once, event)
    expect(twice.lastTool.repeated).toBe(2)
  })
})
