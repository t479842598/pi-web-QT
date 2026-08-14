# Progress Log

## 2026-08-13 - Task: 发消息卡死诊断与修复（服务不可达时的前端兜底）

### What was done
- 诊断"发消息后卡死、无动画、无动静"问题，确认根因：用户环境 pi-web 服务进程（localhost:30141）崩溃/未运行，浏览器页面仍打开，SSE 全部断连（ERR_CONNECTION_RESET），发消息 fetch 失败（ERR_CONNECTION_REFUSED / "Failed to send message: TypeError: Failed to fetch"），前端此前对"服务不可达"静默处理导致永久卡死。
- 验证服务端代码在服务存活时全链路正常（POST prompt、SSE 事件推送、消息落盘，dev 与生产模式均通过 curl 验证），排除 0.9.26/0.9.28 代码逻辑本身导致卡死。
- 修复前端兜底缺陷：
  1. `waitForPromptSettlement`：轮询连续失败（服务不可达）3 次即恢复 UI 并弹出错误提示；轮询窗口耗尽也不再静默退出，改为提示 + 恢复 UI（旧实现两者都静默，agentRunning 卡 true 会拦截后续所有发送）。
  2. `handleSend` catch：非 SSE 连接类错误（服务挂、500、网络错误）时弹出错误提示，不再无声无息。

### Testing
- `node_modules/.bin/tsc --noEmit` 通过（无输出）。
- `node_modules/.bin/eslint hooks/useAgentSession.ts`：仅剩 1 个既有 error（executeBash 的 React Compiler memoization，stash 基线同样存在，与本次改动无关），本次改动无新增问题。
- 功能验证缺口：沙箱环境无法用真实浏览器完整复现"服务崩溃"前端行为（无头浏览器 SSE 收数据受沙箱网络限制），修复逻辑经代码审查确认（连续失败→提示+恢复；超时→提示+恢复）。

### Notes
- 改动文件：`hooks/useAgentSession.ts`（waitForPromptSettlement 增加连续失败/超时收尾分支；handleSend catch 增加非 SSE 错误提示）。
- 回滚：`git checkout hooks/useAgentSession.ts`（本任务前工作区干净，HEAD=ba74b2e）。
- 用户侧立即恢复动作：重新启动 pi-web 服务（`pi-web` 或 `npm run dev`），刷新浏览器页面；服务崩溃原因（内存上限/进程被杀）待排查。

## 2026-08-13 - Task: 发消息后页面接口全部停住（SSE 长连接占满浏览器连接池）

### What was done
- 用户新反馈：测试端（端口 62146）发消息后"整个页面接口停住，切换 tab 才继续走"。在用户真实服务上复现：发送后无 agent 事件到达，普通请求（balance/agent state/running）pending 10-30 秒。
- 根因确认：0.9.26+ 新增了两个无条件常驻 SSE 连接——`SessionSidebar` 的 `/api/agent/running/events`、`ChatInput` 的 `/api/tasks/events`（**未检查 `features.tasksBoard` 开关**）。页面常驻 SSE 达 4 个（+ `/api/events` bus、`/api/agent/[id]/events`），占满浏览器每域 HTTP/1.1 6 连接槽；发送消息时 POST 与页面轮询请求全部排队 → 接口停住；切 tab 关闭 SSE 释放槽位才恢复。服务端 curl 验证响应极快（state 12ms），排除服务端性能问题。
- 修复：`tasksBoardEnabled=false` 时 ChatInput 不再连接 `/api/tasks/events`（也不 fetch 任务统计）。通过 AppShell → ChatWindow → ChatInput 传递开关（AppShell 已有该状态）。用户当前 `features.tasksBoard=false`，生效后常驻 SSE 从 4 降到 3，发送时不再堵死连接池。
- 实证：无头浏览器连用户真实服务，3 个常驻连接场景下发送消息事件流完整（message_start/agent_end/prompt_done）、动画正常、无卡住请求。

### Testing
- `node_modules/.bin/tsc --noEmit` 通过。
- 无头浏览器（连用户 62146 真实服务）对照：4 常驻连接 → 发送后普通请求 pending 10-30s（复现）；3 常驻连接 → 发送后无任何 pending、事件流完整（验证修复方向）。
- 待用户重启测试端后做最终确认（旧代码不会热重载该 prop 链路）。

### Notes
- 改动文件：`components/ChatInput.tsx`（Props + tasksBoardEnabled 条件跳过 tasks SSE/fetch）、`components/ChatWindow.tsx`（Props 透传）、`components/AppShell.tsx`（传 tasksBoardEnabled）。
- 未改动：`SessionSidebar` 的 running/events 常驻连接（核心功能，保留）。
- 回滚：`git checkout components/ChatInput.tsx components/ChatWindow.tsx components/AppShell.tsx`。
- 用户侧动作：重启测试端（62146）后刷新页面再发消息验证；若仍偶发停住，可考虑后续把 running/events 也按需化或合并 SSE 通道。
