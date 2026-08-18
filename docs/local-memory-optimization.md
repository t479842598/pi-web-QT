# 本地运行内存占用优化方案

> 范围:pi-web 本地开发/单机运行(dev server + 浏览器端)。方案含优化目标、具体措施、参考约束;不含操作指南。
>
> **实施状态(2026-08-18):** ✅ 已实现 / ◐ 部分实现 / ⬜ 未实施(附理由)。已实现项均通过 tsc、lint(无新增问题)、506 项测试、dev 启动冒烟。

---

## 1. 现状盘点(已具备的优化,避免重复改动)

| 已落地项 | 位置 |
|---|---|
| V8 堆上限 4GB + 128MB semi-space | `bin/with-memory-limit.js` |
| 会话路径缓存有界(4096 条,LRU 淘汰) | `lib/session-reader.ts` |
| 会话列表缓存 5s TTL + generation 失效保护 | `lib/session-reader.ts` |
| SSE `message_update` 80ms 合并(逐会话路由 + 全局 bus 双层) | `app/api/agent/[id]/events/route.ts`、`lib/rpc-manager.ts` |
| mermaid / mammoth 动态导入 | `components/MarkdownBody.tsx`、`app/api/files/[...path]/route.ts` |
| 消息列表虚拟化 + 滚动跟随 | `components/VirtualizedMessageList.tsx` |
| Markdown 增量渲染(稳定段 intern + memo 组件) | `lib/markdown-incremental.ts`、`components/MarkdownBody.tsx` |
| 加载时 deferThinking / deferMedia(省略思考块与工具结果 base64) | `hooks/useAgentSession.ts`、`lib/session-reader.ts` |
| 组件定时器/监听器均有 cleanup | 各组件 |

**结论:整体基线已较高,剩余内存问题集中在"生命周期与缓存失效策略"层面,而非基础编码缺陷。**

---

## 2. 优化目标

### 2.1 核心目标
1. **降低常驻内存峰值**:空闲状态下不长期持有不需要的会话包装器、缓存快照与流式副本。
2. **避免不必要的对象持有**:会话在无客户端观看时及时回收;列表缓存不因事件风暴反复重建全量数组。
3. **及时释放资源**:SSE 断开、会话切换、标签页后台化等事件触发点必须联动释放对应的 wrapper、定时器、监听器与大对象。

### 2.2 量化目标
| 指标 | 当前(推定) | 目标 |
|---|---|---|
| dev server Node 进程 RSS 峰值 | ≤4GB(堆上限约束) | **≤3.5GB**,堆上限降为 3GB |
| 空闲稳态 RSS | 随打开会话数线性增长 | **≤2GB**(空闲 wrapper ≤ 4 个) |
| 单个空闲 AgentSessionWrapper | 未约束(30min 常驻) | **≤150MB**;关闭页面后 **60s 内回收** |
| 会话列表缓存 | 5s TTL 全量重扫,事件级失效 | 单次快照 **≤10MB**;失效去抖 300ms;稳态 TTL 10s |
| 客户端单会话 messages 状态 | 全量消息数组 | 千条消息级会话 **≤80MB** |
| 流式瞬时副本 | 每 80ms 全量消息 ×3(JSON/state/AST) | **≤ 3× 单条最新消息大小** |
| 后台标签页轮询 | 1s 级定时器持续运行 | 后台时暂停非关键轮询 |

---

## 3. 具体措施

### 3.1 及时释放资源(最高优先级)

**P0-1 会话 wrapper 生命周期收敛 ✅(有偏差,见下)**
- 现状:`globalThis.__piSessions` 中每个 `AgentSessionWrapper` 常驻 30min(空闲超时);SSE 客户端断开时仅 `unsubscribe()`,**不触发 shutdown**。本地点开过的每个会话(含其 AgentSession、模型运行时、扩展绑定、AsyncProcessManager、pendingUi* maps)都持续占用内存。
- 已实施措施:
  1. `app/api/agent/[id]/events/route.ts` 的 cleanup 经 `onEvent` 返回的 unsubscribe 自动递减订阅计数;最后一条订阅断开且会话空闲时,启动 **60s 宽限 shutdown**(`lib/rpc-manager.ts` 新增 `scheduleDisposeIfIdle`,宽限期内重连/新订阅/send 均取消回收)。
  2. 注册表 LRU 上限 `MAX_REGISTERED_SESSIONS = 12`:新增 wrapper 后若超限,按活动时间**最旧优先**淘汰"空闲且无订阅"的 wrapper(流式中/有 SSE 订阅的一律不淘汰)。
  3. **偏差**:空闲超时保持 30min 未降至 10min——task-engine 的会话(`attachEventHandlers` 常驻订阅)在 `awaiting_input` 状态时 `isRunning()` 为 false,缩短空闲超时会增加"等待用户输入超时被杀"的风险;SSE 断开回收已覆盖主要常驻场景,空闲超时收敛收益有限。
- 兼容性:POST 路由已有 "idle-reaped" 重建路径(`startRpcSession` 冷启动 ~2s),回收后可无感重建。

**P0-2 会话列表缓存失效风暴 ✅**
- 现状:`invalidateSessionListCache()` 由 `message_end`/`agent_end`/`entry_appended`/`session_info_changed` 等**事件级**触发;流式期间触发密集,每次失效后 5s TTL 内的下一次访问即触发**全量重扫**(所有 `.jsonl` header + 每 cwd `resolveProject` + settings.json 读取),CPU 与内存双重 churn。
- 已实施措施(`lib/session-reader.ts`):
  1. 失效去抖:**300ms 合并失效**(模块级单定时器),流式高频事件不再逐条触发全量重扫。
  2. 稳态 TTL 5s → **10s**。
  3. `firstMessage` 响应字段**截断至 300 字符**(`FIRST_MESSAGE_MAX_CHARS`)。

**P0-3 全局 bus 消息负载收敛 ⬜(低优先,未实施)**
- 现状:`broadcastSessionBusEvent` 的 `message_update` 携带**全量累积消息**,经 80ms 合并后广播给每个已连接标签页;多标签页时同一负载被 N 次 JSON 序列化/解析。
- 说明:本地单机场景受益有限;80ms 合并已消除 O(n²) 放大。留待多标签/远程场景再处理(内容指纹去重 / delta 传输)。

### 3.2 清理未使用的全局变量与缓存

- `globalThis.__piSessions` / `__piStartLocks` / `__piStartingSessionCwds` / `__piRunningListeners` / `__piSessionBusListeners`:启动锁与起始 cwd 计数已有 finally 清理,保持;订阅函数在 SSE cleanup 中已移除,保持。
- `busCoalesceState`(模块级 Map):定时器触发后已 `delete`,保持。
- 会话路径缓存:已有 4096 上限,保持。
- **✅ 新增 wrapper 生命周期字段**:`subscriberCount`(订阅计数)、`disposeGraceTimer`(宽限回收)、`lastActivityAt`(LRU 活动时间戳),并支持 `hasSubscribers()`/`activityTimestamp` 供注册表淘汰判断。
- **⬜ wrapper 级内存自检**(get_state 附带 maps 大小告警):未实施,列为后续可观测性增强。

### 3.3 控制大对象 / 数组生命周期

**P1-1 客户端流式全量消息拷贝 ◐**
- 现状:每条 `message_update`(80ms)携带全量累积消息;客户端经 JSON 解析 → `streamingMessage` state → Markdown AST 三次拷贝。已用 `createStreamUpdateScheduler` 限频提交(30fps),且**流式中的代码块不触发 Prism 高亮**(MarkdownBody 的 streaming 分支走纯 `<pre>`),AST 峰值已受控。
- 已具备:`message_end` 后 `resetStreamUpdates()` 清空调度器待提交快照;调度器随 hook 卸载 GC。
- ⬜ 长文本分段渲染(远端段延迟渲染):未实施——需配合 `splitStableParts` 扩展,收益边际,风险中等,列为后续。

**P1-2 会话消息状态体积 ◐**
- `deferThinking`/`deferMedia` 已生效(工具结果 base64 图片不进历史载荷)。
- ⬜ 超长单块文本服务端截断(>64KB):未实施,列为可选。

### 3.4 代码分割与懒加载(同时缓解首屏卡顿)

**P1-3 语法高亮瘦身 ✅**
- 现状:`components/MarkdownBody.tsx`、`components/FileViewer.tsx` 均从 `react-syntax-highlighter` 主入口导入 `Prism`——主入口连带加载 refractor 全量(~180 语言)+ 全部样式,两个组件都在首屏 chunk。
- 已实施:新增 `lib/prism-languages.ts` 共享模块,基于 `PrismLight`(refractor/core)按需注册 **33 个常用语言模块 + 别名**(js/ts/tsx/jsx/json/bash/python/css/html/xml/markdown/sql/java/go/rust/yaml/diff/c/cpp/csharp/php/ruby/swift/kotlin/dart/lua/scala/toml/ini/graphql/docker/powershell/json5 等);两个组件改从该模块导入。未注册语言由库自动回退纯文本渲染(已验证)。全量 refractor 与主入口不再被任何代码引用,从 bundle 中剔除。

**P1-4 样式与字体 ⬜**
- `katex.min.css` 全局引入(~20KB CSS,解析成本小);`@fontsource` 4 个权重可按需子集化。收益边际,未实施。

**P2-1 pi-tui 延迟加载 ⬜**
- `lib/rpc-manager.ts` 顶层 `import { KeybindingsManager as TuiKeybindingsManager } from "@earendil-works/pi-tui"`(含 `CUSTOM_UI_KEYBINDINGS` 单例)随首个 agent API 请求加载。
- 说明:`pi-tui` 已列 `serverExternalPackages`(不打进 bundle,服务端原生加载),延迟导入的收益仅为"首个请求的模块解析时间",本地场景影响小;实施需重构 `requestExtensionCustomUi` 路径,列为后续。

### 3.5 释放事件监听与定时器

**P1-5 定时器收敛与后台暂停 ⬜(附理由)**
- 现状分散的周期任务(均挂载期有效):`GoalBanner` 1s、`SubagentsPanel` 1s、`SubagentDetail` 2s、`SessionSidebar` 2.5s 轮询 + 60s 时间刻度、`task-detail-sheet` 5s 重载、`MessageView` 300ms(仅流式)。
- 未实施理由:浏览器对后台标签页的 `setInterval` 已有 ≥1s 节流、rAF 暂停;这些定时器均在组件挂载期且带 cleanup,内存占用占比极小;合并共享 ticker 属渲染层重构,回归风险大于收益。

**✅ 其他已具备**:所有 SSE(每会话 + 全局)在 abort/断开时注销监听并清心跳;`MessageView` 300ms 计时器仅流式期存在且 cleanup 正确。

---

## 4. 参考约束(本地运行内存预算)

| 约束项 | 数值 | 状态 |
|---|---|---|
| dev server 堆上限 | **≤3GB**(`with-memory-limit.js` 4GB→3GB) | ✅ |
| dev server RSS 峰值 | **≤3.5GB**;空闲稳态 **≤2GB** | 目标 |
| 空闲 wrapper 常驻 | **≤150MB/个**;并发空闲 wrapper **≤12 个**(注册表 LRU 上限) | ✅ 上限已生效 |
| 页面关闭 → wrapper 回收 | **60s 宽限 + 回收**(SSE 断开触发) | ✅ |
| 会话列表缓存 | 单快照 **≤10MB**;失效去抖 300ms;TTL 10s | ✅ |
| 客户端单会话消息状态 | **≤80MB**(千条消息级) | 目标 |
| 流式瞬时副本 | **≤3× 最新消息大小**(30fps 限频 + 流式跳过 Prism) | ◐ |
| 后台标签页 | 非关键轮询**暂停**(浏览器原生节流兜底) | ⬜ |
| SSE 生命周期 | 每标签 ≤2 条连接;断开即注销监听,空闲会话联动回收 | ✅ |

## 5. 优先级汇总

| 级别 | 项 | 状态 |
|---|---|---|
| P0 | 会话 wrapper 生命周期收敛(SSE 断开回收 / LRU 上限;空闲超时维持 30min) | ✅ |
| P0 | 会话列表缓存失效去抖 + TTL + firstMessage 截断 | ✅ |
| P0 | 堆上限 4GB→3GB | ✅ |
| P1 | 语法高亮 PrismLight 化(共享模块,33 语言) | ✅ |
| P1 | 流式长文本分段渲染 | ⬜ 后续 |
| P1 | 定时器合并 + 后台暂停 | ⬜ 理由见 §3.5 |
| P2 | pi-tui 延迟导入 / bus 负载去重 / 超长块截断 / wrapper 内存自检 | ⬜ 后续 |
