---
description: "可选强控制面 Guard：为长期 Agent 提供持久目标、可信 World State、验证、事务恢复、委派与轨迹控制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-verified-control

[English](README.md) | 中文

## 概述

`dsh-verified-control` 是 DeepSeek Harness 的可选强控制面。它保留原生 observation-driven Agent Loop、Session、Compaction、Sandbox、并行工具执行与 Subagent Runtime，同时接管概率模型不应独自拥有的边界：Goal Contract、可信 World State、有效权限与预算、验证、commit/rollback、外部副作用 reconciliation、Incident、Delegation Contract 与可选动态 reasoning effort。

核心规则是：**模型可以提出方案和观察；Harness 决定什么允许提交，以及什么才算被验证。**

## 目录

- [使用本包](#use-this-package)
- [控制语义](#control-semantics)
- [验证与恢复](#verification-and-recovery)
- [委派与 Effort](#delegation-and-effort)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

推荐通过 `@deepseek-ai/dsh-verified-control-bundle` 使用，并把它叠加在 `@deepseek-ai/dsh-base` 之后。除非显式加入该 bundle，随仓库发布的 profile 默认行为保持不变。

在 mutation、network、irreversible work 或 delegation 之前，先创建普通持久化 Goal，再调用 `control_set_contract`。Contract 声明 objective、确定性 success checks、安全 invariants、non-goals、申请权限与有限预算；部署配置只能进一步收紧这些请求。`control_amend_contract`、Fact 人工认证和 external-effect reconciliation 使用现有 approval path。

使用 `control_observe_fact` 保存后续步骤依赖的观察。Fact 保存 origin、confidence、observed time、可选 TTL、dependency edges、独立 verifier 身份和有效性。根事实变化或失效会递归使依赖事实失效，过期事实不会进入当前 truth view；模型观察不能自证。

-----

<a id="control-semantics"></a>
## 控制语义

有效权限是 `contract request ∩ deployment policy`。Tool call、failure、duration、重复调用与 delegation budget 同样取更严格的一侧。即使操作预算耗尽，`control_get_state` 仍保持可用，避免恢复路径被控制面自身锁死。

Goal completion 采用 fail-closed：只有全部 success check 与 invariant 都具有确定性 verifier 覆盖并通过时，`update_goal(action=complete)` 才允许执行。配置为 workspace mutation 的工具在执行前和 commit 前都会验证 invariants。

工具失败以及控制面的验证/恢复失败会记录为 Incident，并附带 regression-eval candidate，把真实失败转化为后续评测覆盖。

-----

<a id="verification-and-recovery"></a>
## 验证与恢复

确定性 verifier 支持文件存在/不存在、全文相等、包含文本、已独立认证 Fact 值相等，以及要求 shell 命令成功退出。声明了 check 却没有 verifier 时 fail-closed。

配置的文件 mutation（默认 `write`、`edit`）接入 `tools/execute`。插件通过 `ctx.fs` 捕获前状态、持久化 open transaction、串行化同路径冲突写入、执行工具、验证 invariant，再 commit 或 rollback。Crash recovery 根据持久事务 marker 执行，并使用新的 cleanup deadline，而不是复用可能已经 abort 的 tool signal。

已有文件可以通过任意可写 `FileSystem` 恢复。新建文件只有在 provider 能证明目标是 session workspace 内的 host-backed path 时才自动删除；否则事务进入 `rollback-failed` 并要求 reconciliation，不会假装恢复成功。

配置为 irreversible 的工具使用独立 external-effect 状态机：派发前持久化 `open` marker；成功后确认为 resolved，失败、异常或 crash 后遗留 open marker 会进入 `review`。在人工将其处理为 `confirmed`、`not-applied` 或 `compensated` 之前，后续受控工作被冻结。

-----

<a id="delegation-and-effort"></a>
## 委派与 Effort

Delegation 继续使用 DeepSeek Harness 原生 subagent runtime，包括 `run_in_background`。Verified Control 增加父侧边界：Contract authority、deployment authority、clamped delegation budget，以及通过 `control_prepare_delegation` 创建的 typed record，其中包含 objective、expected evidence 与 resource scope。一个 prepared record 只消费一次配置的 delegation call。

Adaptive effort 为可选能力。启用后，`agent/request` listener 只修改当前请求的 `reasoningEffort`：稳定推进用 baseline，连续失败/重复调用时提升，存在 rollback 或 external-effect recovery risk 时使用 critical effort。它不会改写历史消息或重建 system/tool prefix；具体 effort ID 仍由 adapter/model 定义。

-----

<a id="model-experience"></a>
## 模型体验

模型会看到静态 verified-control policy section，以及 Contract、Fact、Delegation preparation、Reconciliation 和 State inspection 等控制工具。普通工具选择仍是 observation-driven，不存在静态预计算的完整 ToolCall DAG。只要获得授权，可逆本地工作可以自动继续，因为 transaction mechanics 由 Harness 持有。

#### KV Cache 影响

控制 prompt 是静态文本；动态状态通过 tools/session projection 获取，而不是持续插值进 system prefix。Adaptive effort 仅修改 request config。Provider 特定缓存行为仍属于对应 LLM adapter。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

本包不发布 runtime invariant companion，因为权威控制状态已经由经过校验的 session projection 持有，而跨服务安全约束在 tool/agent waterfall 中同步执行。

- 新建文件自动删除仅限可证明的 host-backed workspace path；纯远端文件系统需要人工 reconciliation。
- `command_succeeds` 需要挂载 shell service；服务不可用时会失败而不是静默通过。
- 部署特定 irreversible tools 无法仅根据 generic shell tool 名安全推断，必须显式配置。
- Delegation `resourceScope` 当前是父侧 contract；若要在进程外 child 内强制，需要 provider/tool-filter 提供等价能力。
- Adaptive effort 无法推断具体 provider/model 支持哪些 effort ID。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作上下文——点击展开</summary>

除非确实缺失底层 primitive，否则继续通过 DeepSeek Harness 的公开 seam（`sessionProjections`、`tools/pre-execute`、`tools/execute`、`agent/pre-step`、`agent/request`）承载 hard-control 语义，不 fork core loop。

</details>
