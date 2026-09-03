---
description: "可选 profile bundle：在 base-backed DeepSeek Harness profile 之上叠加 verified-control 的强控制语义。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-verified-control-bundle

[English](README.md) | 中文

## 概述

本 bundle 是 `@deepseek-ai/dsh-verified-control` 的可选 profile 层。它只插入一个 `verified-control` plugin row，并且有意保持 `@deepseek-ai/dsh-base`、`headless`、`web`、`sdk` 与 `acp` 的默认行为不变。

当你希望继续使用 DeepSeek Harness 原生 Agent Loop、Persistence、Sandbox、Compaction、Tools 与 Subagents，同时增加 Goal Contract、World State、Verifier、事务/恢复、外部副作用 reconciliation、Delegation Contract、Incident 与可选 Effort Controller 时，使用本层。

## 目录

- [使用本包](#use-this-package)
- [默认配置](#defaults)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 的有序 `dsh.profile.bundles` 列表中，把本 bundle 放在 `@deepseek-ai/dsh-base` 之后。最小自定义 profile 如下：

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

由于 profile patch row 是整体替换配置块，而不是深度合并，因此一旦要覆盖 `verified-control` row，请在自己的 profile patch 中重写完整 config。

<a id="defaults"></a>
## 默认配置

默认层允许 `write`/`edit` 进入事务，但前提是 Goal Contract 同样申请了 mutation authority。Network authority 在部署层默认关闭，即使 Contract 申请也不会获得；默认不把任何工具归类为 irreversible；delegation 在部署层打开，但仍然要求 Contract authority 与 `control_prepare_delegation`；所有操作预算均为有限值。

通用 bundle 默认关闭 adaptive effort，因为 effort ID 属于具体 model/adapter 的能力。面向 Fable 的 profile 可以单独启用并设置模型支持的 effort ID，而无需修改核心 guard。本 bundle 也不会仅根据工具名把 `bash`/`pwsh` 判定为不可逆外部副作用；部署应显式列出它真正能够判断的副作用工具。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`cordis.patch.yml`](cordis.patch.yml)：完整 opt-in row 与保守默认值。
- [`../base/README.zh.md`](../base/README.zh.md)：profile layering 与 base-backed 组合机制。
- [`../../guard/verified-control/README.zh.md`](../../guard/verified-control/README.zh.md)：完整运行时语义与控制工具。

-----

<a id="model-experience"></a>
## 模型体验

Bundle 自身除了挂载 guard 外不增加动态行为。Guard 会贡献一段静态控制策略 prompt 以及模型可见的控制工具；普通 model/tool observation loop 仍完全使用 DeepSeek Harness 原生机制。

#### KV Cache 影响

Bundle patch 是静态的。Guard 注入的 prompt section 也是静态文本；动态控制状态不会插值进 system prefix。启用 adaptive effort 后，它只改变 request config，不改写既有历史消息。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 这是 opt-in layer；除非显式加入 bundle，否则随仓库发布的 profile 默认行为不变。
- 部署特定的 irreversible tools 与 provider 支持的 effort ID 无法由通用 bundle 安全推断，必须显式配置。
- 覆盖 `verified-control` row 时必须重写完整 config，因为 profile patch 使用整行替换而不是 deep merge。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作上下文——点击展开</summary>

保持本包是薄组合层。强控制逻辑放在 `@deepseek-ai/dsh-verified-control`；只有具体 provider/profile 能证明的能力，应留在对应 provider/profile 中。

</details>
