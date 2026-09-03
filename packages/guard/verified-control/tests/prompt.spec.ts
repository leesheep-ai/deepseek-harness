import { describe, expect, it } from 'vitest'
import { isFable51Model, renderFable51RuntimeContext } from '../src/prompt.ts'

function assembly(model: string, effort?: string, persisted?: { model: string; reasoningEffort?: string }) {
  return {
    agent: {
      options: { model, ...(effort === undefined ? {} : { reasoningEffort: effort }) },
      session: {
        requestHeader: () => persisted === undefined ? undefined : { config: persisted },
      },
    },
  } as any
}

describe('Fable 5.1 runtime prompting', () => {
  it('activates only for official Fable 5.1 ids and varies effort-specific guidance', () => {
    expect(isFable51Model('claude-fable-5-1')).toBe(true)
    expect(isFable51Model('anthropic.claude-fable-5-1')).toBe(true)
    expect(renderFable51RuntimeContext(assembly('claude-opus-5', 'low'))).toBe('')

    const low = renderFable51RuntimeContext(assembly('claude-fable-5-1', 'low'))
    expect(low).toContain('issue them together')
    expect(low).toContain('targeted edits')
    expect(low).toContain('At low effort')
    expect(low).toContain("user's exact spelling")

    const high = renderFable51RuntimeContext(assembly('claude-fable-5-1', 'high'))
    expect(high).not.toContain('At low effort')
    expect(high).not.toContain('long deliverable at this effort')

    const xhigh = renderFable51RuntimeContext(assembly('anthropic.claude-fable-5-1', 'xhigh'))
    expect(xhigh).toContain('long deliverable at this effort')
  })
})
