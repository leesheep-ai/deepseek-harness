---
description: "Optional profile bundle that layers verified-control hard-control semantics on top of a base-backed DeepSeek Harness profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-verified-control-bundle

English | [中文](README.zh.md)

## Summary

This bundle is the opt-in profile layer for `@deepseek-ai/dsh-verified-control`. It inserts one `verified-control` plugin row and deliberately leaves `@deepseek-ai/dsh-base`, `headless`, `web`, `sdk`, and `acp` defaults unchanged.

Use it when you want the existing DeepSeek Harness agent loop, persistence, sandbox, compaction, tools, and subagents plus the verified-control Goal Contract, World State, verifier, transaction/recovery, external-effect reconciliation, delegation contract, incident, and optional effort-controller semantics.

## Table of Contents

- [Use this package](#use-this-package)
- [Defaults](#defaults)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add the bundle after `@deepseek-ai/dsh-base` in a profile's ordered `dsh.profile.bundles` list. A minimal custom profile is:

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

Because profile patch rows replace whole configuration blocks rather than deep-merging them, override the `verified-control` row in your profile patch with a complete config whenever you change a default.

<a id="defaults"></a>
## Defaults

The shipped layer allows transactional `write`/`edit` when the Goal Contract also requests mutation authority. Network authority is deployment-disabled even when requested by a contract, no irreversible tool is classified by default, delegation is enabled but still requires contract authority plus `control_prepare_delegation`, and operational budgets are finite.

Adaptive effort is disabled in the generic bundle because effort identifiers are model/adapter capabilities. A Fable-oriented profile can enable it and set supported effort IDs without changing the core guard. The bundle intentionally does not classify `bash`/`pwsh` as an irreversible external effect solely by tool name; deployments should list concrete side-effecting tools they can reason about.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`cordis.patch.yml`](cordis.patch.yml) — the complete opt-in row and conservative defaults.
- [`../base/README.md`](../base/README.md) — profile layering and base-backed composition mechanics.
- [`../../guard/verified-control/README.md`](../../guard/verified-control/README.md) — complete runtime semantics and control tools.

-----

<a id="model-experience"></a>
## Model Experience

The bundle itself adds no dynamic behavior beyond mounting the guard. The guard contributes one static control-policy prompt section plus its model-facing control tools. The ordinary model/tool observation loop remains native DeepSeek Harness behavior.

#### KV Cache effect

The bundle patch is static. The mounted guard contributes a static prompt section; dynamic state is not interpolated into the system prefix. Adaptive effort, when enabled, changes request configuration rather than rewriting prior messages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This is an opt-in layer; shipped profiles remain unchanged until the bundle is explicitly added.
- Deployment-specific irreversible tools and provider-supported effort identifiers cannot be safely inferred by a generic bundle and therefore require explicit profile configuration.
- A profile override of the `verified-control` row must restate the complete configuration block because profile patches replace rows rather than deep-merge them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep this package a thin composition layer. Hard-control logic belongs in `@deepseek-ai/dsh-verified-control`; provider-specific behavior belongs in the provider/profile that can prove its capabilities.

</details>
