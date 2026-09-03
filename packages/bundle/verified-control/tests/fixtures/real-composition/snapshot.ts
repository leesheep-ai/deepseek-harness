import { fileURLToPath } from 'node:url'
import { assembleContextFor, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'

const rootConfigPath = process.argv[2]
if (rootConfigPath === undefined) throw new Error('verified-control snapshot requires a root config path')

const verifiedPatchPath = fileURLToPath(new URL('../../../cordis.patch.yml', import.meta.url))
const ctx = await boot('verified-control-real-composition', rootConfigPath, [
  ...loadOverlayPatches('verified-control-real-composition', verifiedPatchPath),
])

try {
  const agentId = SessionId('verified-control-real-composition')
  const session = ctx.sessions.create(agentId, { meta: { cwd: process.cwd() } })
  const agent: Agent = {
    ctx,
    id: agentId,
    options: {
      provider: 'anthropic',
      model: 'claude-fable-5-1',
      reasoningEffort: 'low',
    },
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  const signal = new AbortController().signal
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent, signal))
  const policy = assembly.sections.find(section => section.name === 'verified-control:policy')?.text ?? null
  const fableContext = assembly.contexts.find(context => context.name === 'verified-control:fable-5.1')?.text ?? null
  const controlTools = assembly.tools.map(tool => tool.name).filter(name => name.startsWith('control_')).sort()
  const controlState = ctx.sessionProjections.stateOf(session, 'verified-control')

  process.stdout.write(`${JSON.stringify({
    policy,
    fableContext,
    controlTools,
    projectionRegistered: controlState?.contract === null && controlState.toolCalls === 0,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
