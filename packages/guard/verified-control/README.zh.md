---
description: "可选控制面 Guard：把长期 Agent 的目标、权限、世界状态、验证、变更事务、外部副作用、委派与恢复变成显式可验证语义。"
kind: "package-reference"
---

# @deepseek-ai/dsh-verified-control

[English](README.md) | 中文

## 概述

`dsh-verified-control` 是 DeepSeek Harness 的可选控制面。它不替换原生 Agent Loop、Session、Compaction、Sandbox、并行工具执行或 Subagent Runtime，而是接管概率模型不应独自拥有的控制权：持久化 Goal Contract、具备新鲜度语义的 World State、有效权限与预算上限、独立验证、工作区变更事务、外部副作用不确定性处置、委派契约、恢复、事故记录以及动态 reasoning effort。

核心规则是：**模型可以提出方案、做观察；Harness 决定什么允许提交，以及什么才算被验证。**

## 目录

- [使用本包](#use-this-package)
- [控制语义](#control-semantics)
- [验证与事务](#verification-and-transactions)
- [委派与 Effort](#delegation-and-effort)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

推荐通过可选的 `@deepseek-ai/dsh-verified-control-bundle` 安装，并把它作为 profile 中位于 `@deepseek-ai/dsh-base` 之后的一层。该 bundle 不会修改任何随仓库发布的 base-backed profile 的默认行为。

若直接做 Cordis 组合，请在 `fs`、`goals`、`sessionProjections` 与 `tools` 可用之后挂载本插件。默认配置有意偏保守：网络权限关闭、不可逆工具列表为空、动态 effort 关闭，只有 `write`/`edit` 被视为可事务化的工作区变更。

开始受控工作前，Agent 先创建普通持久化 Goal，再调用 `control_set_contract`。Contract 声明目标、确定性成功条件、安全不变量、非目标、申请的权限与预算。模型不能静默替换 Contract：`control_amend_contract` 始终进入人工审批路径。

World State 通过 `control_observe_fact` 更新。模型观察可以持久化，但不会自动获得独立认证；只有人工 attestation 或确定性 verifier 成功后，`verifiedBy` 才会非空。Fact 保存置信度、观察时间、可选 TTL、依赖边与有效性。根事实发生变化或失效时，其依赖事实会递归失效；过期事实不会出现在当前真值视图中。

-----

<a id="control-semantics"></a>
## 控制语义

有效权限取 Goal Contract 申请值与部署配置允许值的交集，模型永远不能放大平台权限。工具次数、失败次数、持续时间、重复调用和委派预算同样采用更严格的一侧。

Mutation、Network、Irreversible、Delegation 都由显式工具列表分类。即使普通操作预算已经耗尽，`control_get_state` 仍保持可用，避免控制面把恢复路径自己锁死。Contract 修改、Fact 人工认证和外部副作用 reconciliation 等治理工具继续复用 DeepSeek Harness 现有 approval service。

Goal 完成采用 fail-closed。只有全部成功条件与 invariant 都有确定性 verifier 覆盖且验证通过后，`update_goal(action=complete)` 才能执行。配置为工作区 mutation 的工具在执行前也会验证安全 invariant，mutation 完成后还会再次验证，之后才提交。

-----

<a id="verification-and-transactions"></a>
## 验证与事务

当前支持的确定性 verifier 包括：文件存在/不存在、文件全文相等、文件包含文本、已独立认证 Fact 的值相等，以及要求 shell 命令成功退出。声明了检查项却没有 verifier，不会被视为成功。

配置的文件 mutation（默认 `write`、`edit`）接入原生 `tools/execute` waterfall。派发前通过 `ctx.fs` 获取目标快照并写入持久化 open-transaction marker；同一文件上的冲突事务串行执行。工具失败、执行抛错或 mutation 后 invariant 验证失败都会触发 rollback。恢复使用独立 cleanup deadline，不复用可能已经 abort 的工具 signal。

已有文件可通过任意可写 `FileSystem` 恢复。对于“新建文件”的删除回滚，只有 provider 能证明目标是 session workspace 内的 host-backed path 时才自动删除；无法证明时 fail-closed，留下持久化 `rollback-failed` 状态等待人工处置，而不会假装已回滚。

被配置为不可逆外部副作用的工具使用不同状态机：派发前写 `open` marker；成功结果表示确认生效；失败、异常或进程恢复时发现遗留 open marker，都会转成 `review`。在人工将其确认为 `confirmed`、`not-applied` 或 `compensated` 前，普通受控工作被冻结。这样不会给邮件发送、部署、数据库写入等操作伪造“可回滚”语义。

工具失败以及控制面的验证/恢复失败都会记录 Incident，并同时生成 regression-eval candidate，方便把真实失败轨迹沉淀为后续评测覆盖。

-----

<a id="delegation-and-effort"></a>
## 委派与 Effort

委派仍使用 DeepSeek Harness 原生 subagent 能力，包括前台调用和 `run_in_background`。Verified Control 只增加父 Agent 侧的边界：父 Goal Contract 必须申请 delegation、部署策略必须允许、clamped delegation budget 必须还有余量，并且模型必须先调用 `control_prepare_delegation` 创建 typed contract，明确 objective、expected evidence 和 resource scope。一个 prepared contract 只消费一次配置的 delegation tool 调用。

动态 reasoning effort 是可选能力。启用后，`agent/request` listener 只改变当前请求的 `reasoningEffort`，不会改写 transcript 历史，也不会重建 system/tool prefix。稳定推进时使用 baseline；连续失败或重复工具调用达到阈值时提升到 elevated；存在恢复风险或严重失败连续出现时提升到 critical。Effort ID 是 adapter 自己拥有的字符串，因此部署需要填写对应模型真正支持的值。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`src/index.ts`](src/index.ts)：组合与配置入口。
- [`src/policy.ts`](src/policy.ts)：权限、预算、fail-closed completion 与 invariant gate。
- [`src/state.ts`](src/state.ts)：World State 的 freshness、失效与认证语义。
- [`src/transaction-runtime.ts`](src/transaction-runtime.ts)：mutation 的 prepare/execute/verify/commit/rollback wiring。
- [`src/external-effect-runtime.ts`](src/external-effect-runtime.ts)：外部副作用不确定性 reconciliation。
- [`src/delegation-runtime.ts`](src/delegation-runtime.ts)：父 Agent 侧 typed delegation contract。
- [`src/effort.ts`](src/effort.ts)：基于轨迹风险的 test-time compute 调度。

-----

<a id="model-experience"></a>
## 模型体验

模型会在普通 DeepSeek Harness 工具之外看到一组较小的控制工具：设置/修改 Contract、观察/验证/人工认证/失效 Fact、准备委派、处置不确定外部副作用，以及读取控制状态。模型仍然基于每一步真实 observation 自己决定下一次普通工具调用，不存在静态预生成完整 ToolCall DAG。

控制失败会以普通 tool error 形式返回，并附带明确的纠正信息。对于可逆的本地工作，模型无需管理 transaction 细节；人工审批集中在控制边界变化与不确定外部副作用，而不是常规可恢复操作。

#### KV Cache 影响

插件不会注入持续变化的 system prompt 前缀。动态 effort 通过 request config 应用，持久化控制数据通过 tool/session projection 读取，从而尽量减少 prompt prefix 抖动。Provider 特定的缓存语义继续由对应 LLM adapter 负责。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 新建文件自动删除只支持 `ctx.fs` 能证明位于 host-backed workspace 内的目标；纯远端文件系统的该场景需要人工 reconciliation。
- `command_succeeds` 需要挂载 shell service；没有 shell 的组合会让该 verifier 失败，而不是静默通过。
- 外部副作用语义依赖部署正确配置 irreversible tool 名单。默认名单为空，因为无法仅根据 generic shell tool 名称安全判断具体命令是否不可逆。
- Delegation contract 约束父侧 launch boundary；若要在进程外 child 内强制 `resourceScope`，还需要对应 subagent provider/tool filter 暴露等价能力。
- 动态 effort 无法证明所有 provider 都支持配置的每个 effort ID；兼容性仍属于具体 adapter/model 的契约。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作上下文——点击展开</summary>

本包刻意只通过 DeepSeek Harness 的公开 seam（`sessionProjections`、`tools/pre-execute`、`tools/execute`、`agent/pre-step`、`agent/request`）集成，而不 fork core loop。新增 hard-control 语义优先继续放在这里，除非所需基础 primitive 的确不存在于 core。

</details>
