import type { Context } from '@deepseek-ai/cordis'

const VERIFIED_CONTROL_PROMPT = `When verified-control tools are available, treat them as the hard control plane for long-running work.
- Before mutation, network, irreversible work, or delegation, make sure there is a durable goal and set a Goal Contract with objective, deterministic success checks, safety invariants, non-goals, requested authority, and finite budgets.
- Use control_observe_fact for durable observations that future steps depend on. A model observation is not independently verified; use control_verify_fact or request human attestation when a fact must satisfy a verifier.
- Do not reinterpret tool observations as assertions. Verification decides pass/fail.
- Before delegating, call control_prepare_delegation with the child objective, expected evidence, and resource scope; independent children may still run in the background through the native subagent tool.
- Reversible local work may proceed autonomously when the contract allows it; transaction/rollback mechanics are owned by the harness.
- If control_get_state reports rollback-failed or an external effect in review, stop further controlled work and surface the reconciliation requirement instead of assuming recovery succeeded.
- Do not claim the goal complete until its deterministic checks pass; update_goal(action=complete) is the final commit boundary.`

export function installControlPrompt(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'verified-control:policy',
    order: ctx.systemPrompt.getSectionOrder('TOOL_GOAL') + 10,
    text: VERIFIED_CONTROL_PROMPT,
  })
}
