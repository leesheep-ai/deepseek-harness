---
description: "Adds an opt-in control plane for goal contracts, deployment-capped authority, durable budgets, trusted facts and recoverable mutations without changing the core agent loop."
kind: "package-reference"
---

# @deepseek-ai/dsh-verified-control

## Summary

`verified-control` is an opt-in guard for long-running agents. It keeps DeepSeek Harness's existing observation-driven loop, tool scheduler, goals, session log and compaction behavior, while moving authority and committed truth out of the model. The first baseline establishes durable control state, deployment-capped Goal Contracts, budget enforcement, freshness-aware facts, and filesystem rollback helpers. It deliberately does not modify `dsh-agent-loop`.

## Current phase

Phase 0 is intentionally narrow. It provides the package boundary and core invariants that later commits will extend with model-facing contract tools, verifier mesh integration, durable transaction recovery, external-effect reconciliation, and adaptive reasoning effort.

## Safety boundary

Structured filesystem mutations can be made recoverable by the transaction layer. Arbitrary shell commands are not automatically transactional: a command may mutate resources outside the workspace, so later policy commits classify explicitly irreversible tools instead of pretending every shell call can be rolled back.

## Model Experience

### Tool-call policy decisions

#### What the model sees

A controlled tool call may be denied with a concise reason when no Goal Contract exists, a deployment capability is not granted, or a durable budget is exhausted.

#### Token effect

Conditional and small: only denied or approval-gated calls add policy text to the model-visible tool result path.

#### KV Cache effect

The package does not rewrite prior conversation messages; policy feedback is append-only, preserving reusable prefixes subject to provider cache behavior.

## Known Limitations and Deferred Work

- **No model-facing contract tool yet** — Phase 0 exposes the host-side contract primitive; the next commit adds a typed tool and completion gate.
- **Transaction helpers are not wired into `tools/execute` yet** — Phase 0 tests the mechanism independently before integrating it into the live tool pipeline.
- **No automatic shell rollback** — arbitrary shell side effects remain outside the filesystem transaction guarantee.
