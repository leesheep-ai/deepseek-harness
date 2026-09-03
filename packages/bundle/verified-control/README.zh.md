---
description: "可选 profile bundle：在 base-backed DeepSeek Harness profile 上叠加 verified-control 强控制语义。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-verified-control-bundle

[English](README.md) | 中文

## 概述

本 bundle 是 `@deepseek-ai/dsh-verified-control` 的可选 profile 层。它只插入一个 `verified-control` plugin row，并有意保持随仓库发布的 `base`、`headless`、`web`、`sdk` 与 `acp` 默认行为不变。

当你希望继续使用 DeepSeek Harness 原生 Agent Loop、Session、Sandbox、Compaction、Tools 与 Subagents，同时增加 Goal Contract、World State、Verifier、事务/恢复、外部副作用 reconciliation、Delegation Contract、Incident 与可选 Effort Controller 时使用本层。

## 目录

- [使用本包](#use-this-package)
- [默认配置](#defaults)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 的有序 bundle 列表中，把本 bundle 放在 `@deepseek-ai/dsh-base` 之后：

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

Profile patch row 是整块替换而非 deep merge，因此如果用户覆盖 `verified-control` row，需要重写希望保留的全部配置项。

<a id="defaults"></a>
## 默认配置

通用层只在 Goal Contract 同样申请 mutation authority 时允许 `write`/`edit` 进入事务。部署层 network authority 默认关闭；默认不把任何工具归类为 irreversible；delegation 虽在部署层开启，但仍要求 Contract authority 与 `control_prepare_delegation`；所有操作预算均为有限值。

Adaptive effort 默认关闭，因为 effort ID 属于具体 model/adapter 能力。面向特定 provider 的 profile 可以单独启用并填写模型支持的 effort ID。Bundle 也不会仅根据工具名把 `bash`/`pwsh` 判断为 irreversible；部署应显式列出其语义能够被可靠判断的副作用工具。

-----

<a id="model-experience"></a>
## 模型体验

### 已挂载的 Verified Control 表面

#### 模型看到什么

Bundle 自身不增加独立的动态模型内容；它挂载 `@deepseek-ai/dsh-verified-control`，因此模型看到的是该 guard 的静态 verified-control policy section 与 `control_*` 工具 schema。所有依数据变化的控制状态和工具结果仍由 guard 持有并渲染。

#### Token 影响

Token 成本来自已挂载 guard 的固定 policy/tool-schema 前缀，以及实际使用控制工具时产生的依数据变化 tool traffic。Bundle 自身不会额外添加模型消息、工具 schema 或周期性全量状态序列化。

#### KV Cache 影响

Bundle patch 为静态内容，已挂载 guard 的 policy/tool definitions 在固定组合中也保持稳定。因此除了 guard 已记录的 request configuration 变化和追加式 tool traffic 外，bundle 不会引入额外的 cache invalidation。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

本包不发布 runtime invariant companion，因为它只是静态 profile patch 载体，自身不持有可变运行时状态。

- 这是 opt-in 层；只有显式加入 bundle 后才会改变 profile 行为。
- 部署特定 irreversible tools 与模型支持的 effort ID 必须显式配置。
- 覆盖 `verified-control` row 时必须重写完整配置块。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作上下文——点击展开</summary>

保持本包为薄组合层。Hard-control 逻辑属于 `@deepseek-ai/dsh-verified-control`；只有具体 provider/profile 能证明的行为才应留在对应 provider/profile 中。

</details>
