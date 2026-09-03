---
description: "可选强控制面 Guard：为长期 Agent 提供持久目标、可信 World State、验证、事务恢复、委派与轨迹控制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-verified-control

[English](README.md) | 中文

## 概述

`dsh-verified-control` 是 DeepSeek Harness 的可选强控制面。它保留原生 observation-driven Agent Loop、Session、Compaction、Sandbox、并行工具执行与 Subagent Runtime，同时接管概率模型不应独自拥有的边界：Goal Contract、可信 World State、有效权限与预算、验证、commit/rollback、外部副作用 reconciliation、Incident、Delegation Contract、可选动态 reasoning effort、模型感知的 Claude Fable 5.1 runtime guidance，以及 Fable thinking-prefix 强制校验。

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

在 mutation、network、irreversible work 或 delegation 之前，先创建普通持久化 Goal，再调用 `control_set_contract`。Contract 声明 objective、确定性 success checks、安全 invariants、non-goals、申请权限与有限预算；部署配置只能进一步收紧这些请求。被接受的 Contract 会持久绑定到该 Goal id 及其精确 objective；如果后续编辑 Goal objective，已有 Contract 会立刻视为 stale，直到 `control_amend_contract` 获得显式人工批准。`control_amend_contract`、Fact 人工认证和 external-effect reconciliation 使用现有 approval path。

使用 `control_observe_fact` 保存后续步骤依赖的观察。Fact 保存 origin、confidence、observed time、可选 TTL、dependency edges、独立 verifier 身份和有效性。根事实变化或失效会递归使依赖事实失效，过期事实不会进入当前 truth view；模型观察不能自证。

-----

<a id="control-semantics"></a>
## 控制语义

有效权限是 `contract request ∩ deployment policy`。Tool call、failure、duration、重复调用与 delegation budget 同样取更严格的一侧。Failure budget 表示“允许容忍的失败次数”：`maxFailures: 0` 在尚未发生失败时仍允许正常工作，但第一次观测到失败后立即 fail-closed。即使操作预算耗尽，`control_get_state` 与新 Goal 的 Contract 建立仍保持可用，避免恢复路径或新目标被旧计数器锁死。

每个 Goal Contract 都只作用于一个持久化 Goal id 及其精确 objective。持久 Goal 的 `create` 或 `clear` 会重置 Goal-scoped 的 Contract、预算、delegation、重复调用、duration 与 recovery counters；可信 Fact、Incident 历史以及尚未解决的 transaction/external-effect 状态不会被清空，因为这些仍可能描述下一 Goal 必须面对的真实世界或安全状态。同一个 Goal 上经人工批准的 Contract amendment 不会重置已经消耗的预算。

Goal completion 继续采用 fail-closed，但它被视为“经过验证的 commit 操作”，而不是另一份普通 operational work。即使 tool/failure/duration budget 已经到达边界，只要任务确实完成，`update_goal(action=complete)` 仍可进入最终验证；但只要还有任何 transaction 或 external effect 未收口、Contract 已 stale/绑定到别的 Goal，或者任一 success check/invariant 缺少确定性 verifier 覆盖或验证失败，completion 都会被拒绝。配置为 workspace mutation 的工具在执行前和 commit 前也都会验证 invariants。

Autonomous continuation 同样 fail-closed。在 `agent/turn-stopping` 边界，如果检测到 tool/duration budget 耗尽、failure tolerance 已耗尽、重复工具调用卡死、未解决 rollback failure 或 external-effect review，Verified Control 会把原生 Goal 转为 `blocked`。这样仍由既有 `goal-round-driver` 唯一负责自动轮次与 round accounting；Verified Control 不会引入第二套 continuation loop。

Claude Fable 5.1 thinking replay 也采用 fail-closed。在派发一个仍保留 replay-bound Fable reasoning block 的 Fable 请求前，guard 会重建该 block 生成时位于它之前的 model-visible surface，并与当前 retained prefix、system prompt 和有序 tool definitions 比较。如果更早消息被替换、只 compact 了 retained thinking 之前的历史、system prompt 被修改或 tool schema 被修改，就产生 `FABLE_PREFIX_MISMATCH`；若当前存在 active Goal，则会持久化转为 `blocked`，而不是继续发送已知会违反 Fable prefix binding 的 provider request。

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

Claude Fable 5.1 会额外获得一层模型感知的 runtime-context overlay，其设计依据 [Claude Fable 5.1 prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1)。它只对官方 `claude-fable-5-1` 与 `anthropic.claude-fable-5-1` model id 生效。基础 overlay 要求模型完成已经授权的完整工作、批量发出相互独立的 tool call、限制 patch/committed tests 范围、优先 targeted edit、background subagent 运行时继续推进父任务，以及在长 tool chain 中提供简短进度信息。`low` effort 会额外强调 search/retrieval 验证；`xhigh` 与 `max` 会额外约束长输出时不要在 reasoning 中完整起草后再重复生成。

-----

<a id="model-experience"></a>
## 模型体验

### Verified Control 策略、控制工具与 Fable 5.1 runtime context

#### 模型看到什么

一段静态 verified-control policy 会要求模型在受控工作前建立持久化 Goal 与 Goal Contract，把需要跨步骤使用的观察记录为 Fact 但不把模型观察视为已独立验证，在启动 subagent 前准备 typed delegation contract，并在存在未解决 rollback 或 external-effect review 时停止继续受控执行。模型同时会看到稳定的 `control_*` 工具 schema。`control_get_state` 会把持久 Contract binding（`contractGoalId`）、freshness-aware Facts 与 recovery state 一起返回；完整控制状态不会被持续注入每次请求。达到硬 continuation condition 时，原生 Goal 会进入 `blocked`，因此不会再调度下一次自动 goal round。Fable 5.1 路由还会通过现有 runtime-context snapshot 机制获得上述模型/effort 感知 guidance；其他模型不会收到 Fable contribution。Prefix-binding 校验完全由 Harness 执行，正常路径不会增加模型提醒；只有 mismatch 才会变成显式 request error 与 blocked-goal reason。

#### Token 影响

插件挂载后，静态 policy 与控制工具 schema 会产生固定的 request-prefix token 成本。依数据变化的 Contract、World State、Transaction、Incident 与 Delegation 内容只会通过普通工具调用/结果进入保留的对话历史；插件不会在每次请求中持续序列化全部控制状态。Fable overlay 对其他模型为空。对于 Fable 5.1，它只会在完整 runtime-context snapshot 发生变化时写入，因此稳定 route/effort 不会每次 request 都追加一条提醒。Prefix-binding inspection 是本地 replay 分析，不增加 request token。

#### KV Cache 影响

固定组合中的静态 policy 文本与工具定义保持稳定，因此可以留在可复用 request prefix。Adaptive effort 只修改 request config，不改写历史消息。Fable-specific guidance 使用动态 runtime-context snapshot：DeepSeek Harness 会把它作为持久 user-role message 追加，并明确标记新 snapshot supersede 旧 runtime-context snapshot。因此 effort-specific guidance 变化时仍保持 append-only conversation history，而不是修改之前的 system/tool/message prefix。Prefix guard 会拒绝任何让 retained Fable thinking block 跨越 cache-invalidating prefix mutation 的请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

本包不发布 runtime invariant companion，因为权威控制状态已经由经过校验的 session projection 持有，而跨服务安全约束在 tool/agent waterfall 中同步执行。

- 新建文件自动删除仅限可证明的 host-backed workspace path；纯远端文件系统需要人工 reconciliation。
- `command_succeeds` 需要挂载 shell service；服务不可用时会失败而不是静默通过。
- 部署特定 irreversible tools 无法仅根据 generic shell tool 名安全推断，必须显式配置。
- Delegation `resourceScope` 当前是父侧 contract；若要在进程外 child 内强制，需要 provider/tool-filter 提供等价能力。
- Adaptive effort 无法推断具体 provider/model 支持哪些 effort ID。
- Fable route detection 发生在 prompt assembly 阶段，早于当前 step 的 `agent/request` waterfall。如果 middleware 只在该 waterfall 内把 non-Fable/空 route 改为 Fable，已经完成 assembly 的第一次 request 不会被追溯修改，而会从下一次 assembled step 开始获得 overlay。
- Harness 通用 LLM seam 当前没有暴露 Anthropic beta 的 `thinking.block_binding.prefix_mismatch_behavior: "drop_block"`。因此 Verified Control 在检测到 prefix mismatch 时 fail-closed。需要继续时，应开启新 conversation，或把 replay-bound Fable thinking block 本身一并 compact 出 retained history；如果只替换它之前的旧历史却继续保留该 block，按设计仍然属于无效 prefix。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作上下文——点击展开</summary>

除非确实缺失底层 primitive，否则继续通过 DeepSeek Harness 的公开 seam（`sessionProjections`、`tools/pre-execute`、`tools/execute`、`agent/pre-step`、`agent/turn-stopping`、`agent/request`、append-only runtime context 与 durable session/surface replay）承载 hard-control 语义，不 fork core loop。

</details>
