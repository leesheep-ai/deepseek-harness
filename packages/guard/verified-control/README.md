---
description: "Opt-in control-plane guard for durable goals, trusted world state, verification, transactional mutations, recovery, delegation, and trajectory control."
kind: "package-reference"
---

# @deepseek-ai/dsh-verified-control

English | [中文](README.zh.md)

## Summary

`dsh-verified-control` is an opt-in hard control plane for DeepSeek Harness. It keeps the native observation-driven agent loop, sessions, compaction, sandbox, parallel tool execution, and subagent runtime, while owning the boundaries a probabilistic model should not own alone: Goal Contract, trusted World State, effective authority and budgets, verification, commit/rollback, external-effect reconciliation, incidents, delegation contracts, and optional adaptive reasoning effort.

The governing rule is: **the model may propose and observe; the harness decides what may commit and what counts as verified.**

## Table of Contents

- [Use this package](#use-this-package)
- [Control semantics](#control-semantics)
- [Verification and recovery](#verification-and-recovery)
- [Delegation and effort](#delegation-and-effort)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The recommended path is `@deepseek-ai/dsh-verified-control-bundle`, layered after `@deepseek-ai/dsh-base`. Shipped profiles are unchanged unless that bundle is explicitly added.

Before controlled mutation, network activity, irreversible work, or delegation, create a normal durable goal and call `control_set_contract`. The contract declares the objective, deterministic success checks, safety invariants, non-goals, requested authority, and finite budgets. Deployment configuration can only reduce those requests. `control_amend_contract`, human fact attestation, and external-effect reconciliation enter the existing approval path.

Use `control_observe_fact` for durable observations. Facts carry origin, confidence, observation time, optional TTL, dependency edges, independent verifier identities, and validity. Changing or invalidating a root fact recursively invalidates dependents, and stale facts disappear from the current truth view. Model observations do not self-certify.

-----

<a id="control-semantics"></a>
## Control semantics

Effective authority is `contract request ∩ deployment policy`. Tool-call, failure, duration, repeated-call, and delegation budgets are similarly clamped to the stricter side. `control_get_state` remains available when operational budgets are exhausted so recovery cannot deadlock itself.

Goal completion is fail-closed: `update_goal(action=complete)` is denied until all declared success checks and invariants have deterministic verifier coverage and pass. Configured workspace mutations also verify invariants before execution and again before commit.

Autonomous continuation is fail-closed too. At `agent/turn-stopping`, verified control converts hard no-progress or unsafe conditions — exhausted tool/failure/duration budgets, repeated-tool stalls, unresolved rollback failure, or unresolved external-effect review — into the native goal `blocked` phase. The existing `goal-round-driver` therefore remains the only owner of automatic rounds and round accounting; verified control never adds a parallel continuation loop.

The plugin records tool failures and control-plane verification/recovery failures as incidents with regression-eval candidates, turning real failures into future test coverage.

-----

<a id="verification-and-recovery"></a>
## Verification and recovery

Deterministic verifier specs cover file existence/absence, exact content, contained text, independently certified fact equality, and shell commands that must exit successfully. A declared check without a verifier fails closed.

Configured file mutations (`write` and `edit` by default) are wrapped at `tools/execute`. The plugin captures the pre-state through `ctx.fs`, persists an open transaction, serializes conflicting writes to the same path, executes the tool, verifies invariants, then commits or rolls back. Crash recovery runs from durable transaction markers with a fresh cleanup deadline rather than a possibly aborted tool signal.

Existing files can be restored through any writable `FileSystem`. Automatic deletion of a newly created file is limited to a path that the provider can prove is host-backed and inside the session workspace; otherwise the transaction becomes `rollback-failed` and requires reconciliation instead of pretending recovery succeeded.

Configured irreversible tools use a separate external-effect state machine. An `open` marker is persisted before dispatch; success resolves it as confirmed, while failure, exception, or crash-orphaning moves it to `review`. Further controlled work is frozen until a human resolves the effect as `confirmed`, `not-applied`, or `compensated`.

-----

<a id="delegation-and-effort"></a>
## Delegation and effort

Delegation continues to use DeepSeek Harness' native subagent runtime, including `run_in_background`. Verified control adds the parent-side boundary: contract authority, deployment authority, a clamped delegation budget, and a typed `control_prepare_delegation` record containing objective, expected evidence, and resource scope. One prepared record is consumed by one configured delegation call.

Adaptive effort is optional. When enabled, an `agent/request` listener changes only the current request's `reasoningEffort`: stable progress uses baseline effort, failure/repetition raises it, and rollback/external-effect recovery risk uses critical effort. It never rewrites previous messages or rebuilds the system/tool prefix. Effort identifiers remain adapter/model capabilities.

-----

<a id="model-experience"></a>
## Model Experience

### Verified-control policy and control tools

#### What the model sees

A static verified-control policy section tells the model to establish a durable goal and Goal Contract before controlled work, record durable observations without treating them as self-verified facts, prepare typed delegation contracts before subagent launches, and stop on unresolved rollback or external-effect review. The model also receives the stable schemas for the `control_*` tools. Dynamic control state is returned only when those tools are called; ordinary tool choice remains observation-driven. If a hard continuation condition is reached, the native goal state becomes `blocked`, so the next autonomous goal round is not scheduled.

#### Token effect

The static policy and control-tool schemas add a fixed request-prefix cost while this plugin is mounted. Data-dependent contract, World State, transaction, incident, and delegation values add tokens only through ordinary tool calls/results that enter retained conversation history; the plugin does not continuously serialize the full control state into every request.

#### KV Cache effect

The policy text and tool definitions are stable for a mounted composition, so they remain part of the reusable request prefix. Adaptive effort changes request configuration rather than rewriting prior messages, and dynamic control data is append-only tool traffic, so the plugin does not intentionally invalidate earlier prefix cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No runtime invariant companion is published because the authoritative control state is a validated session projection and cross-service safety is enforced synchronously in the tool and agent waterfalls.

- New-file deletion rollback is intentionally limited to provable host-backed workspace paths; remote-only filesystems require manual reconciliation for that case.
- `command_succeeds` requires a mounted shell service and fails rather than silently passing when the service is unavailable.
- Deployment-specific irreversible tools cannot be inferred from a generic shell tool name and must be configured explicitly.
- Delegation `resourceScope` is enforced as a parent-side contract; enforcing it inside an out-of-process child requires equivalent provider/tool-filter support.
- Adaptive effort cannot infer which identifiers a selected provider/model supports.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep hard-control semantics on public DeepSeek Harness seams (`sessionProjections`, `tools/pre-execute`, `tools/execute`, `agent/pre-step`, `agent/turn-stopping`, and `agent/request`) instead of forking the core loop unless a genuinely missing primitive must be added upstream.

</details>
