# 修复计划：会话打不开超时 / 折叠代码丢失 / 运行状态延迟

## 根因（已核实代码）

**问题一：会话打不开，一直加载中然后报错**
- 前端 `GET /api/sessions/[id]` 有 30s 硬超时（hooks/useAgentSession.ts:1116），超时报 "Timed out loading this conversation"。
- 服务端慢的根源：
  1. 路径缓存未命中时 `listAllSessions()` 全盘逐行解析所有 jsonl（当前库 494 个文件约 490MB），而列表缓存仅 10s TTL，且活跃会话的每个事件都会整体失效它 → 只要后台有会话在跑，每次打开大会话都可能撞上一次全盘扫描；
  2. 存在 51MB 的超大单会话文件，`SessionManager.open` 同步全量解析、阻塞整个事件循环数秒，LRU 只存 6 个；
  3. `startRpcSession` 的 25s 超时只作用于网络 AbortSignal，`createAgentSessionFromServices`（扩展绑定/MCP/资源发现）不受控——一旦挂起，`__piStartLocks` 里的共享 Promise 永不落定、锁永不清理，该会话之后所有请求永久挂死（表现为"某些会话彻底打不开"）。

**问题二：粘贴的大段代码发出去只剩摘要**
- 粘贴 ≥2000 字符或 ≥20 行时输入框替换为占位符 `[已粘贴文本 #N · X 行]`，原文存在 React state `pastedBlocks`；正常发送时 `handleSend`（ChatInput.tsx:791-795）会还原原文，但 `sendQueued`（ChatInput.tsx:1170，流式中排队/steer/followup）**没有还原逻辑**；且 `pastedBlocks` 不进草稿，切换会话/刷新导致组件重挂载后丢失——这两种情况下占位符原样进入消息。历史已发送消息原文未入会话文件，无法追溯恢复。

**问题三：会话在跑但点开不显示运行状态**
- 打开会话时先等消息全量加载完成（大会话可达 15-30s）才查 `/state` 判断 running（useAgentSession.ts:1107-1216 → 3398-3420），期间聊天页只有无标识的 loading 占位；SSE 也是判定之后才连；idle 兜底 GET 只补发一次、失败不再重试。

## 修复方案

### A. 会话打开可靠性（止血+根因）— 新 spec（00-default 下，如 28-00-session-open-reliability）
1. **启动锁硬超时兜底**（lib/rpc-manager.ts ~2280-2510）：`createAgentSessionFromServices` 单独包 40s 上限、整个 starting 流程包 60s 总上限；超时 abort、尽力清理半成品、reject 明确错误，确保 `.finally` 清锁，锁永不悬挂——"彻底打不开的会话"可自愈。
2. **openSessionCached 同路径 in-flight 去重**（lib/session-reader.ts ~395-421）：并发打开同一会话共享同一个解析 Promise。
3. **列表缓存增量重扫（根因）**（lib/session-reader.ts）：维护 path→{mtimeMs,size,info} 映射，缓存 miss 时只对 stat 变化/新增的文件重新解析、剔除已删除文件，替代现在的全盘逐行重扫；统计字段（projectRoot 分组、stats 等）与现状保持一致。注意 AGENTS.md 提醒"会话文件可被整体重写"——mtime/size 变化自然覆盖。
4. **客户端韧性**：lib/agent-client.ts `sendAgentCommand` 加默认 30s 超时（可覆盖）；`loadSession` 超时自动重试一次。

### B. 折叠代码发送丢失 — task 落 01-00-chat-composer-ui-refresh（回退 in-progress）
1. 抽 `expandPastedLabels(value, blocks)`，`handleSend` 与 `sendQueued` 共用，排队发送同样还原原文。
2. `pastedBlocks` 持久化进草稿（ChatDraft 加可选字段 + draft-store 同步读写），重挂载/刷新后仍能展开。
3. 防护兜底：发送前若仍含占位符但找不到对应 block，阻止发送并提示，杜绝静默丢内容。

### C. 运行状态及时显示 — task 落 13-00-multi-client-realtime-sync（回退 in-progress）
1. **state 查询并行化**：`loadSession` 里 `/state` 与消息请求并行启动，state 一到即 `restoreRunning`，不等消息加载。
2. **挂载即连 SSE**：mount 时 `connectEvents(sid)`，利用 events 路由 connect 时的 `state_sync` 立即断言 running；沿用现有空闲宽限关闭/重连，保证幂等不重复连。
3. **idle 兜底有界重试**：单发 GET 改为 2s×5 次（仅仍 idle 时），撞上 wrapper shutdown 中间态也能自愈。

## 治理与流程
- A：`spec_create` + WHEN/THEN 验收 + gate ready/completion；B、C：`spec_update` 回 in-progress + `task_create`；开工 `task_update(in_progress)`、收口 `completed`；踩坑 `error_record`。
- 验证：`tsc --noEmit`、`npm run lint`、相关单测（A3 增量重扫需覆盖：文件变更/新增/删除/整体重写四类）；手工验证三个场景（后台跑会话时打开大会话、流式中排队发送粘贴代码、点开运行中会话立即显示状态）。

## 发版 0.14.3（已确认）
按发布规范：`npm version 0.14.3 --no-git-tag-version` → CHANGELOG.md 新条目 → `npm run build` + `npm publish --access public` → git commit + tag `v0.14.3` + push → `gh release create`（正文引 CHANGELOG）。