import { describe, expect, it } from 'vitest'
import { fablePrefixMismatchReason, isClaudeThinkingSourceForFable51 } from '../src/fable-prefix.ts'

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

function assistant(model = 'claude-fable-5-1', id = 'a-1') {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'reasoning', text: 'signed reasoning' }],
    source: {
      kind: 'model',
      provider: 'anthropic',
      model,
      replayState: {
        response: { kind: 'pi-ai', version: 2, api: 'anthropic-messages', provider: 'anthropic', model, stopReason: 'stop' },
        blocks: [{ type: 'reasoning', thinkingSignature: 'sig' }],
      },
    },
  }
}

function fixture(messages: any[], boundAssistant = assistant()) {
  const events = [
    {
      type: 'request/header', seq: 0, time: 1,
      data: { header: { config: { provider: 'anthropic', model: boundAssistant.source.model }, system: 'stable', tools: [tool] }, reason: 'initial' },
    },
    { type: 'user/message', seq: 1, time: 2, data: user, surfaceOp: 'append' },
    { type: 'assistant/message', seq: 2, time: 3, data: { turn: 1, step: 1, message: boundAssistant }, surfaceOp: 'append' },
  ] as any[]
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
  it('recognizes Claude thinking sources that Fable 5.1 can inherit', () => {
    expect(isClaudeThinkingSourceForFable51('claude-fable-5-1')).toBe(true)
    expect(isClaudeThinkingSourceForFable51('anthropic.claude-opus-5')).toBe(true)
    expect(isClaudeThinkingSourceForFable51('publishers/anthropic/models/claude-mythos-5')).toBe(true)
    expect(isClaudeThinkingSourceForFable51('gpt-5.6')).toBe(false)
  })

  it('accepts the exact historical message, system, and tool prefix', () => {
    const bound = assistant()
    expect(fablePrefixMismatchReason(fixture([user, bound], bound), assembly())).toBeUndefined()
  })

  it('checks preserved thinking inherited from an older Claude model', () => {
    const bound = assistant('claude-opus-5', 'a-opus')
    expect(fablePrefixMismatchReason(fixture([replacementUser, bound], bound), assembly()))
      .toContain('model-visible messages before Claude thinking block')
  })

  it('ignores replay-bound reasoning from non-Claude models', () => {
    const bound = assistant('gpt-5.6', 'a-gpt')
    expect(fablePrefixMismatchReason(fixture([replacementUser, bound], bound), assembly())).toBeUndefined()
  })

  it('detects an earlier model-visible message replacement such as partial compaction', () => {
    const bound = assistant()
    expect(fablePrefixMismatchReason(fixture([replacementUser, bound], bound), assembly()))
      .toContain('model-visible messages before Claude thinking block')
  })

  it('detects system prompt and tool definition changes', () => {
    const bound = assistant()
    expect(fablePrefixMismatchReason(fixture([user, bound], bound), assembly('changed')))
      .toContain('system prompt changed')
    expect(fablePrefixMismatchReason(fixture([user, bound], bound), assembly('stable', [{ ...tool, description: 'changed' }])))
      .toContain('tool definitions changed')
  })
})
