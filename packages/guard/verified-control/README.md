---
description: "Opt-in control-plane guard that makes goals, authority, world state, verification, mutations, external effects, delegation, and recovery explicit for long-running agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-verified-control

English | [中文](README.zh.md)

## Summary

`dsh-verified-control` is an opt-in control plane for DeepSeek Harness. It does not replace the native agent loop, sessions, compaction, sandbox, parallel tool execution, or subagent runtime. Instead it owns the parts a probabilistic model should not own by itself: a durable Goal Contract, freshness-aware World State, effective authority and budget limits, independent verification, transactional workspace mutation, uncertain external-side-effect reconciliation, delegation contracts, recovery, incidents, and adaptive reasoning effort.

The core rule is: **the model may propose and observe; the harness decides what may commit and what counts as verified.**

## Table of Contents

- [Use this package](#use-this-package)
- [Control semantics](#control-semantics)
- [Verification and transactions](#verification-and-transactions)
- [Delegation and effort](#delegation-and-effort)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The recommended installation path is the optional `@deepseek-ai/dsh-verified-control-bundle`, layered after `@deepseek-ai/dsh-base` in a profile. The bundle mounts this plugin without changing any shipped base-backed profile by default.

For a direct Cordis composition, mount the plugin after `fs`, `goals`, `sessionProjections`, and `tools` are available. Defaults are deliberately conservative: network authority is disabled, irreversible tools are empty, adaptive effort is disabled, and only `write`/`edit` are treated as transactional workspace mutations.

Before controlled work, the agent creates a normal durable goal and calls `control_set_contract`. The contract declares the objective, deterministic success checks, safety invariants, non-goals, requested authority, and requested budgets. The model cannot silently replace the contract: `control_amend_contract` always enters the human-approval path.

World State is updated through `control_observe_fact`. Model observations are durable but not independently certified; `verifiedBy` remains empty until a human attestation or deterministic verifier succeeds. Facts carry confidence, observation time, optional TTL, dependency edges, and validity. Replacing or invalidating a root fact recursively invalidates dependent facts, and stale facts disappear from the current truth view.

-----

<a id="control-semantics"></a>
## Control semantics

Effective authority is the intersection of what the Goal Contract requests and what deployment configuration allows. The model can never widen deployment policy. Tool, failure, duration, repeated-call, and delegation budgets are likewise clamped to the stricter limit.

Controlled mutation, network, irreversible, and delegation tool sets are explicit configuration lists. `control_get_state` remains available even when ordinary operational budgets are exhausted so the control plane cannot deadlock its own recovery path. Human governance tools such as contract amendment, fact attestation, and external-effect reconciliation use the existing approval service.

Goal completion is fail-closed. `update_goal(action=complete)` is denied until every declared success criterion and invariant has deterministic verification coverage and every check passes. Safety invariants are also checked before configured workspace mutations and re-checked after the mutation before commit.

-----

<a id="verification-and-transactions"></a>
## Verification and transactions

Supported deterministic verifier specs include file existence/absence, exact file content, contained text, independently certified fact equality, and shell commands that must exit successfully. A declared check without a verifier is not treated as success.

Configured file mutations (`write` and `edit` by default) run through the native `tools/execute` waterfall. Before dispatch, the plugin snapshots the target through `ctx.fs`, writes a durable open-transaction marker, and serializes conflicting transactions on the same file. Tool failure, thrown execution, or post-mutation invariant failure triggers rollback. Recovery uses a separate cleanup deadline instead of a potentially aborted tool signal.

Existing files can be restored through any writable `FileSystem` implementation. Removing a newly created file is automatic only when the provider proves a host-backed path inside the session workspace. If that proof is unavailable, rollback fails closed and leaves a durable `rollback-failed` transaction requiring review rather than pretending the mutation was undone.

Tools configured as irreversible external effects use a different state machine. The plugin writes an `open` marker before dispatch. A successful tool result confirms the effect; a failure, exception, or process restart with an orphaned marker becomes `review`. Ordinary controlled work is frozen until a human resolves the effect as `confirmed`, `not-applied`, or `compensated`. This deliberately avoids fictitious rollback semantics for email, deployments, database writes, and similar effects.

Every tool failure and control-plane verification/recovery failure records an incident with a regression-eval candidate so repeated failures can become future evaluation coverage.

-----

<a id="delegation-and-effort"></a>
## Delegation and effort

Delegation remains DeepSeek Harness' native subagent capability, including foreground and `run_in_background` execution. Verified control adds a parent-side boundary: a Goal Contract must request delegation, deployment policy must allow it, the clamped delegation budget must remain, and the model must first create a typed `control_prepare_delegation` contract containing an objective, expected evidence, and resource scope. One prepared contract is consumed by one configured delegation tool call.

Adaptive reasoning effort is optional. When enabled, an `agent/request` listener changes only the current request's `reasoningEffort`; it does not rewrite transcript history or rebuild the system/tool prefix. Stable progress uses the baseline effort, repeated calls or consecutive failures use the elevated effort, and recovery risk or a critical failure streak uses the critical effort. The effort identifiers are adapter-owned strings, so deployments should configure values supported by their selected model.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`src/index.ts`](src/index.ts) — composition and configuration surface.
- [`src/policy.ts`](src/policy.ts) — authority, budgets, fail-closed completion and invariant gates.
- [`src/state.ts`](src/state.ts) — World State freshness, invalidation, and attestation semantics.
- [`src/transaction-runtime.ts`](src/transaction-runtime.ts) — mutation prepare/execute/verify/commit/rollback wiring.
- [`src/external-effect-runtime.ts`](src/external-effect-runtime.ts) — uncertain external-side-effect reconciliation.
- [`src/delegation-runtime.ts`](src/delegation-runtime.ts) — typed parent-side delegation contracts.
- [`src/effort.ts`](src/effort.ts) — trajectory-driven test-time compute scheduling.

-----

<a id="model-experience"></a>
## Model Experience

The model sees a small set of explicit control tools in addition to the ordinary DeepSeek Harness tool catalog: set/amend contract, observe/verify/attest/invalidate facts, prepare delegation, reconcile uncertain external effects, and read control state. The model still chooses ordinary tools observation-by-observation; there is no static precomputed tool-call DAG.

Failures are surfaced as ordinary tool errors with actionable control feedback. Successful local reversible work proceeds without asking the model to micromanage transaction mechanics. Human approval is reserved for control-boundary changes and uncertain external effects rather than routine reversible work.

#### KV Cache effect

The plugin does not inject a changing system-prompt prefix. Adaptive effort is applied through request configuration, and durable control data is read through tools/session projection, minimizing prompt-prefix churn. Provider-specific cache semantics remain owned by the selected LLM adapter.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Automatic deletion of a newly created file is intentionally limited to host-backed workspace paths that `ctx.fs` can prove; remote-only filesystems require manual reconciliation for that case.
- `command_succeeds` requires a mounted shell service; compositions without one fail that verifier instead of silently passing it.
- External-effect semantics depend on deployment configuration correctly classifying irreversible tools. The default list is empty because a generic shell command cannot be safely classified from its tool name alone.
- Delegation contracts constrain the parent-side launch boundary. Enforcing `resourceScope` inside an out-of-process child requires the selected subagent provider/tool filter to expose an equivalent capability.
- Adaptive effort cannot prove that every provider accepts every configured effort identifier; adapter/model compatibility remains the provider's contract.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package intentionally integrates through public DeepSeek Harness seams (`sessionProjections`, `tools/pre-execute`, `tools/execute`, `agent/pre-step`, and `agent/request`) instead of forking the core loop. Keep new hard-control semantics here unless the required primitive is genuinely missing from core.

</details>
