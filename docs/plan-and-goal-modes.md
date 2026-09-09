# 计划模式与目标模式：实现说明与 v0.17.7 修复

本文说明 pi-web 的计划模式（plan）与目标模式（goal）如何工作、此前为什么坏掉，以及 v0.17.7 的修法与实证过程。

---

## 一、先搞清楚「扩展工具始终可用」是哪些工具

`lib/rpc-manager.ts` 的 `withExtensionTools()` 有一条规则：**凡是不在 `["read","bash","powershell","edit","write","grep","find","ls"]` 里的工具，一律加进激活列表**，与输入框的工具预设无关。

这是有意设计——工具预设管的是「编码工具」，不该因为选了只读就把 `Agent`、`mcp_*` 悄悄砍掉。但它带来一个后果：**只读预设拦不住会写文件的扩展工具**。

当前安装的扩展注册的工具（读源码逐个确认）：

| 扩展包 | 工具 |
|---|---|
| `@tintinweb/pi-subagents` | `Agent`、`get_subagent_result`、`steer_subagent` |
| `pi-web-access` | `web_search`、`source_check`、`fetch_content`、`get_search_content` |
| `pi-review-loop` | `review_loop` |
| `pi-supervisor` | `start_supervision` |
| `@narumitw/pi-lsp` | `lsp_diagnostics`、`lsp_fix` |
| `@ff-labs/pi-fff` | `ffgrep`、`fffind` |
| `@narumitw/pi-plan-mode` | `plan_mode_question`、`plan_mode_complete` |
| `pi-mcp-extension` | `mcp_lrnev_*`（约 42）、`mcp_anysearch_*`（4）、`mcp_deepseek_vision_*`（3，lazy） |
| `dsh-router`（全局扩展） | `dev_router_status`、`dev_router_mode`、`dev_mode_subagent` |
| `pi-midrun-compact`、`vibe-island` | 无工具 |

其中 `lsp_fix`、`start_supervision`、`review_loop` 会改文件。

**v0.17.7 的做法**：不动默认行为，新增 `~/.pi/agent/extension-tools.json` 存「被关闭的扩展工具名」，在「设置 → 工具」页逐个开关。无配置时过滤集合为空，行为与之前完全一致。

```json
{ "version": 1, "disabled": ["lsp_fix", "start_supervision"] }
```

实现见 `lib/extension-tools.ts`（`filterDisabledExtensionTools` 是纯函数，`withExtensionTools` 调用它）。

一个隐藏地雷：`@ff-labs/pi-fff` 切到 `override` 模式会注册 `grep`/`find`，与内置同名，会被 `CODING_TOOL_NAMES` 误判成内置。当前是默认模式，未触发。

---

## 二、计划模式

### 谁在负责

`@narumitw/pi-plan-mode` 扩展是真正的实现方：`/plan` 进入、`/plan exit` 退出，它接管只读工具集（`read`/`bash`/`grep`/`find`/`ls` + `plan_mode_question`/`plan_mode_complete`），并通过 tool policy 拦截 `edit`/`write` 和不安全 bash 命令。pi-web 只负责驱动它并展示结果。

### v0.17.7 之前的问题

1. **两套状态会漂移**：前端有一个独立的 `planMode` 布尔值（React state，切会话即丢），另有一个按会话持久化的 `collaborationMode`。两者只在 UI 层手动同步，可能出现「提示词注入了计划块但只读工具集没生效」。
2. **移动端没有入口**：协作模式控件只在非移动端渲染。
3. **「提出建议」静默失效**：走 `steer`，而该对话框只在运行结束后出现，此时 steer 只入队、不启动新 run。
4. **「执行」竞态**：退出扩展命令与执行 prompt 并发进入准入队列。

### v0.17.7 的修法

- `planMode` 改为派生值：`const planMode = collaborationMode === "plan"`。单一状态源。
- 新增 `syncPlanModeExtension(next)`：只在「进入/离开」的转变时驱动 `/plan` 或 `/plan exit`，并在退出后显式 `set_tools` 恢复预设（防止扩展命令内部失败把会话锁死在只读工具集）。
- `handleCollaborationModeChange` 返回 Promise，等扩展驱动完成再 resolve，`handlePlanExecute` 因此不会与工具集恢复竞态；切换失败也照常执行。
- 协作模式控件在所有视口显示。
- 「提出建议」改用 `handleSend`（真实 prompt）。

### 实证

用真实会话验证（`/plan` → 读工具列表 → `/plan exit` → 再读）：

```
before /plan: edit active = true  | write = true
in plan:      edit active = false | write = false | plan_mode_complete active = true
after exit:   edit active = true  | write = true
```

---

## 三、目标模式

### 设计

`lib/goal-engine.ts` 是纯状态机（+ sidecar 持久化到 `<session>.jsonl.goal.json`）；`lib/rpc-manager.ts` 负责驱动。状态：`idle / running / paused / blocked / budget_limited / complete`，默认 10 轮上限、连续 4 轮无工具调用判为停滞。

### 关键根因：continuation 被自己的忙标志挡掉

SDK 在 `prompt()` 的 `finally` 里发出 `agent_settled`（`agent-session.js` 的 `_emitAgentSettled`），**早于** wrapper 的 `prompt.then` 把 `promptRunning` 置回 false。旧代码在 settle 回调里直接 kick，守卫 `if (this.promptRunning) return` 必然命中，且之后没有任何补偿驱动——所以目标模式只跑一轮就停，只有点「恢复」才继续（恢复路径 arm 了 continuation 绕过守卫）。

第二层问题：旧实现用 `followUp()` 发 continuation，而 SDK 只在**一次 run 的收尾循环**里 drain follow-up 队列（`_handlePostAgentRun`），对已空闲的会话只会静默排队。

### v0.17.7 的修法

1. `handleGoalSettled` 只记 `goalContinuationPending = true`，然后调 `maybeDriveGoalContinuation()`。
2. `maybeDriveGoalContinuation` 用 `setTimeout(0)` 延到 SDK run 的 `finally` 之后，再由 `tryDriveGoalContinuation` 检查 wrapper 是否真的空闲。
3. 在 `prompt.then` / `prompt.catch` 里也补一次驱动（兜住 timer 早于 `promptRunning` 清理的情况）。
4. `driveGoalContinuation` 改用 `inner.prompt()` 真正启动一轮，并走与用户消息相同的 `acquirePromptAdmission` 准入锁，自行管理 `promptRunning`/`promptPhase` 并 emit `prompt_done`/`prompt_error`。

### 一并修掉的四个问题

- **每条消息都重置目标**：现在只在 `status === "idle"` 且消息含文本时启动（`shouldStartGoal`）。
- **纯图片起空目标**：不再启动（服务端会拒绝空 goalText，旧代码还把错误吞了）。
- **token 统计算整个会话**：基线改为「目标开始时的会话累计」（`currentSessionUsageTotal()`），而非 0。
- **标记误判**：`blocked:` 用子串匹配会命中 `unblocked:` / `not blocked:`；`goal is complete` 会命中「once the goal is complete we can ship」。现在 `blocked:` 要求词边界且不被 `not` 否定，complete 要求出现在句首/行首。
- **暂停/停止清空用户队列**：旧 pause/stop 调 `clearQueue()`，连带丢掉用户的 steer/follow-up。现在只 `cancelGoalContinuation()`。

### 实证

用真实会话启动目标后**不再发送任何消息**，观察 `turnsUsed` 自行增长：

```
t+6s  status=running turnsUsed=2
t+12s status=running turnsUsed=3
t+60s status=blocked turnsUsed=4   ← 停滞检测生效（每轮无工具调用）
goal_stop → status=idle，之后不再驱动
```

---

## 四、相关文件

| 文件 | 作用 |
|---|---|
| `lib/goal-engine.ts` | 目标状态机 + 标记判定 |
| `lib/rpc-manager.ts` | goal 驱动、plan 扩展调用、`withExtensionTools` |
| `lib/extension-tools.ts` | 扩展工具开关的读写与过滤 |
| `hooks/useAgentSession.ts` | `planMode` 派生、`syncPlanModeExtension`、goal 启动判定 |
| `components/ModeControls.tsx` | 协作模式选择器（所有视口可见） |
| `components/ToolsConfig.tsx` | 扩展工具开关 UI |
| `components/PlanReviewDialog.tsx` | 计划评审（执行/建议/退出） |

测试：`lib/goal-engine.test.mjs`、`lib/extension-tools.test.mjs`、`hooks/useAgentSession.test.mjs`（计划模式单状态源 + 反馈改 prompt）、`lib/rpc-manager.test.mjs`（continuation 用 prompt 而非 followUp）。
