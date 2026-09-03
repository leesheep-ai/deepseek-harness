import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import GoalService from '@deepseek-ai/dsh-goal'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as VerifiedControl from '@deepseek-ai/dsh-verified-control'

function controlSurface(assembly: Awaited<ReturnType<SystemPrompt['assemble']>>) {
  return {
    policy: assembly.sections.some(section => section.name === 'verified-control:policy'),
    context: assembly.contexts.some(context => context.name === 'verified-control:fable-5.1'),
    tools: assembly.tools.map(tool => tool.name).filter(name => name.startsWith('control_')).sort(),
  }
}

async function host(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
  await ctx.plugin(GoalService)
  return ctx
}

describe('verified-control HMR safety', () => {
  it('removes every registry contribution on unload and can reload cleanly', async () => {
    const ctx = await host()
    const session = ctx.sessions.create(SessionId('verified-control-hmr'), { meta: { cwd: process.cwd() } })

    expect(ctx.sessionProjections.stateOf(session, 'verified-control')).toBeUndefined()
    expect(controlSurface(await ctx.systemPrompt.assemble())).toEqual({ policy: false, context: false, tools: [] })

    const first = await ctx.plugin(VerifiedControl)
    const during = controlSurface(await ctx.systemPrompt.assemble())
    expect(during.policy).toBe(true)
    expect(during.context).toBe(true)
    expect(during.tools).toHaveLength(9)
    expect(ctx.sessionProjections.stateOf(session, 'verified-control')).toBeDefined()

    await first.dispose()
    expect(ctx.sessionProjections.stateOf(session, 'verified-control')).toBeUndefined()
    expect(controlSurface(await ctx.systemPrompt.assemble())).toEqual({ policy: false, context: false, tools: [] })

    const second = await ctx.plugin(VerifiedControl)
    expect(controlSurface(await ctx.systemPrompt.assemble()).tools).toHaveLength(9)
    expect(ctx.sessionProjections.stateOf(session, 'verified-control')).toBeDefined()
    await second.dispose()

    expect(ctx.sessionProjections.stateOf(session, 'verified-control')).toBeUndefined()
    expect(controlSurface(await ctx.systemPrompt.assemble())).toEqual({ policy: false, context: false, tools: [] })

    await ctx.fiber.dispose()
  })
})
