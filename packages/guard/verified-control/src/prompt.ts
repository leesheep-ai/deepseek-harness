import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'

const VERIFIED_CONTROL_PROMPT = `When verified-control tools are available, treat them as the hard control plane for long-running work.
- Before mutation, network, irreversible work, or delegation, make sure there is a durable goal and set a Goal Contract with objective, deterministic success checks, safety invariants, non-goals, requested authority, and finite budgets.
- Use control_observe_fact for durable observations that future steps depend on. A model observation is not independently verified; use control_verify_fact or request human attestation when a fact must satisfy a verifier.
- Do not reinterpret tool observations as assertions. Verification decides pass/fail.
- Before delegating, call control_prepare_delegation with the child objective, expected evidence, and resource scope; independent children may still run in the background through the native subagent tool.
- Reversible local work may proceed autonomously when the contract allows it; transaction/rollback mechanics are owned by the harness.
- If control_get_state reports rollback-failed or an external effect in review, stop further controlled work and surface the reconciliation requirement instead of assuming recovery succeeded.
- Do not claim the goal complete until its deterministic checks pass; update_goal(action=complete) is the final commit boundary.`

const FABLE_51_MODELS = new Set([
  'claude-fable-5-1',
  'anthropic.claude-fable-5-1',
])

interface ModelPromptState {
  model?: string
  effort?: string
}

type AgentAssembleContext = AssembleContext & { agent?: Agent }

/** Whether one provider-owned model id is an official Claude Fable 5.1 id. */
export function isFable51Model(model: string | undefined): boolean {
  return model !== undefined && FABLE_51_MODELS.has(model.trim().toLowerCase())
}

/** Resolve the model-facing route known before this step's request waterfall. */
function modelPromptState(context: AssembleContext): ModelPromptState {
  const agent = (context as AgentAssembleContext).agent
  if (agent === undefined) return {}
  const persisted = agent.session.requestHeader()?.config
  const configuredModel = agent.options.model?.trim()
  const model = configuredModel && configuredModel.length > 0 ? configuredModel : persisted?.model
  const effort = agent.options.reasoningEffort !== undefined
    ? String(agent.options.reasoningEffort)
    : persisted !== undefined && persisted.model === model && persisted.reasoningEffort !== undefined
      ? String(persisted.reasoningEffort)
      : undefined
  return {
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  }
}

/**
 * Render append-only, model-specific execution guidance for Fable 5.1.
 * The runtime-context snapshot is durable and explicitly supersedes its older
 * snapshot, so effort-specific reminders do not rewrite the request prefix.
 */
export function renderFable51RuntimeContext(context: AssembleContext): string {
  const { model, effort } = modelPromptState(context)
  if (!isFable51Model(model)) return ''

  const rules = [
    'Claude Fable 5.1 execution guidance for this step:',
    '- Finish all work already authorized by the user and Goal Contract before ending the turn. Do not ask permission for a next step that is already in scope; continue until complete, blocked by policy/approval, or stopped by a hard control condition.',
    '- When tool calls are independent, issue them together; serialize only calls with a real data or side-effect dependency.',
    '- Keep code changes and committed tests to the requested behavior. Report unrelated bugs or possible extensions instead of silently adding them.',
    '- Prefer targeted edits over whole-file rewrites when the end result is equivalent and most of the file is not changing.',
    '- When background subagents can work independently, keep making useful parent progress and wait only when their result becomes a dependency.',
    '- During long tool chains, provide brief user-facing progress updates that state what changed and what comes next.',
  ]

  if (effort === 'low') {
    rules.push('- At low effort, when an available and authorized search/retrieval tool can verify an unfamiliar or fast-moving name such as an AI model, developer tool, API, or product, verify it before relying on memory and include the user\'s exact spelling in at least one query.')
  }
  if (effort === 'xhigh' || effort === 'max') {
    rules.push('- For a long deliverable at this effort, use reasoning for analysis, checks, structure, and difficult decisions; do not draft the complete deliverable in reasoning and then write it again in the answer.')
  }

  return rules.join('\n')
}

export function installControlPrompt(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'verified-control:policy',
    order: ctx.systemPrompt.getSectionOrder('TOOL_GOAL') + 10,
    text: VERIFIED_CONTROL_PROMPT,
  })
  ctx.systemPrompt.context({
    name: 'verified-control:fable-5.1',
    order: ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 10,
    text: renderFable51RuntimeContext,
  })
}
