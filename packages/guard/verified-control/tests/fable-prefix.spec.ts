import { describe, expect, it } from 'vitest'
import { fablePrefixMismatchReason } from '../src/fable-prefix.ts'

const tool = { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: {} } }
const user = {
  id: 'u-1',
  role: 'user',
  content: [{ type: 'text', text: 'inspect' }],
  source: { kind: 'user' },
}
const replacementUser = {
  id: 'u-2',
  role: 'user',
  content: [{ type: 'text', text: 'compacted' }],
  source: { kind: 'plugin', plugin: 'test' },
}
const assistant = {
  id: 'a-1',
  role: 'assistant',
  content: [{ type: 'reasoning', text: 'signed reasoning' }],
  source: {
    kind: 'model',
    provider: 'anthropic',
    model: 'claude-fable-5-1',
    replayState: { response: { kind: 'pi-ai' } },
  },
}
const events = [
  {
    type: 'request/header', seq: 0, time: 1,
    data: { header: { config: { provider: 'anthropic', model: 'claude-fable-5-1' }, system: 'stable', tools: [tool] }, reason: 'initial' },
  },
  { type: 'user/message', seq: 1, time: 2, data: user, surfaceOp: 'append' },
  { type: 'assistant/message', seq: 2, time: 3, data: { turn: 1, step: 1, message: assistant }, surfaceOp: 'append' },
] as any[]

function fixture(messages: any[]) {
  const session = {
    seq: events.length,
    eventAt: (seq: number) => events[seq],
    deriveMessages: () => messages,
  }
  return { session } as any
}

function assembly(system = 'stable', tools: any[] = [tool]) {
  return {
    sections: [{ name: 'policy', text: system }],
    contexts: [],
    tools,
    variables: {},
  } as any
}

describe('Fable 5.1 thinking prefix binding', () => {
  it('accepts the exact historical message, system, and tool prefix', () => {
    expect(fablePrefixMismatchReason(fixture([user, assistant]), assembly())).toBeUndefined()
  })

  it('detects an earlier model-visible message replacement such as partial compaction', () => {
    expect(fablePrefixMismatchReason(fixture([replacementUser, assistant]), assembly()))
      .toContain('model-visible messages before Fable thinking block')
  })

  it('detects system prompt and tool definition changes', () => {
    expect(fablePrefixMismatchReason(fixture([user, assistant]), assembly('changed')))
      .toContain('system prompt changed')
    expect(fablePrefixMismatchReason(fixture([user, assistant]), assembly('stable', [{ ...tool, description: 'changed' }])))
      .toContain('tool definitions changed')
  })
})
