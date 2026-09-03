---
description: "Optional profile bundle that layers verified-control hard-control semantics on top of a base-backed DeepSeek Harness profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-verified-control-bundle

English | [中文](README.zh.md)

## Summary

This bundle is the opt-in profile layer for `@deepseek-ai/dsh-verified-control`. It inserts one `verified-control` plugin row and deliberately leaves shipped `base`, `headless`, `web`, `sdk`, and `acp` defaults unchanged.

Use it when you want the existing DeepSeek Harness agent loop, sessions, sandbox, compaction, tools, and subagents plus the verified-control Goal Contract, World State, verifier, transaction/recovery, external-effect reconciliation, delegation contract, incidents, and optional effort controller.

## Table of Contents

- [Use this package](#use-this-package)
- [Defaults](#defaults)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add the bundle after `@deepseek-ai/dsh-base` in a profile's ordered bundle list:

```json
{
  "name": "verified-profile",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-verified-control-bundle"
      ]
    }
  }
}
```

Profile patch rows replace complete configuration blocks rather than deep-merging them, so a user override of the `verified-control` row must restate every setting it intends to keep.

<a id="defaults"></a>
## Defaults

The generic layer enables transactional `write`/`edit` only when the Goal Contract also requests mutation authority. Deployment-level network authority is disabled, no irreversible tool is classified by default, delegation is enabled but still requires contract authority and `control_prepare_delegation`, and all operational budgets are finite.

Adaptive effort is disabled because effort identifiers are model/adapter capabilities. A provider-oriented profile can enable it and supply supported effort IDs. The bundle also does not classify `bash`/`pwsh` as irreversible merely from the tool name; deployments should list concrete side-effecting tools whose semantics they can actually reason about.

-----

<a id="model-experience"></a>
## Model Experience

The bundle itself only mounts the guard. The guard adds one static control-policy prompt section and its explicit control tools while keeping ordinary model/tool interaction observation-driven.

#### KV Cache effect

The patch and control prompt are static. Dynamic state is not interpolated into the system prefix; adaptive effort, when enabled, changes request configuration only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No runtime invariant companion is published because this package is a static profile-patch carrier with no mutable runtime state of its own.

- This is opt-in; shipped profiles remain unchanged until the bundle is explicitly added.
- Deployment-specific irreversible tools and model-supported effort identifiers must be configured explicitly.
- Profile overrides of the `verified-control` row must restate the complete configuration block.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep this package a thin composition layer. Hard-control logic belongs in `@deepseek-ai/dsh-verified-control`; provider-specific behavior belongs in the provider/profile that can prove its capabilities.

</details>
