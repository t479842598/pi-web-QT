# 子代理运行过程展示功能 — 交付说明

> 日期：2026-08-20 ｜ 状态：已完成并验证（tsc 0 error / eslint 0 error）

## 功能效果（已按需求实现）

1. **主对话直接显示子代理**：模型调用 `Agent`/`Task` 工具时，对话流中出现子代理卡片——运行中显示旋转加载动画 + 「正在处理」标题 + 子代理类型/描述 + **最新一条运行内容**（实时轮询 transcript），完成/失败/停止后显示对应状态色与汇总。
2. **点击全屏跳转**：点击卡片，主对话区域切换为子代理运行对话页（完整 transcript 对话视图，运行中实时刷新），输入框被覆盖隐藏。
3. **返回主对话**：页面顶部「返回」按钮恢复主对话与输入框。

## 实现方案

| 文件 | 改动 |
|---|---|
| `components/SubagentCard.tsx`（新增） | 卡片组件：spinner（复用 `@keyframes spin`）+ 状态 + 最新内容预览（运行中 2s 轮询 `/api/subagents/transcript`） |
| `components/MessageView.tsx` | `BlockView` 对 `Agent`/`Task` 工具渲染卡片；props 链透传 `subagents` + `onOpenSubagent` |
| `components/ChatWindow.tsx` | 新增 props 并透传 |
| `components/AppShell.tsx` | 全屏子代理页用 **absolute 覆盖层**渲染（ChatWindow 保持挂载，SSE/会话不断流） |
| `lib/i18n/messages/*.ts` | 新增「正在处理/Processing」文案 |

## 关键架构决策

- **覆盖层而非替换**：若条件替换 ChatWindow，useAgentSession 会随卸载销毁、SSE 断开导致运行中的会话/子代理中断。全屏页以 `position:absolute; inset:0; z-index:30` 覆盖，底层会话保持活跃。
- **子代理无独立 session 文件**：子代理跑在 pi-subagents 临时内存会话中，transcript 文件是唯一持久记录，因此"跳转到子代理对话"是渲染 transcript 实时视图（只读）。

## 后续可增强

- 支持在子代理对话页继续发消息（调 pi-subagents `steer_subagent` 工具，需新增后端 API）
- 深链支持：`?session=X&subagent=Y` 刷新直达
- transcript 由 2s 轮询改为 SSE 推送

## 验证

- `tsc --noEmit`：exit 0
- `eslint`（改动 4 文件）：0 errors（AppShell 4 个既有 router warning 与本次无关）
- P0 规则扫描：新代码无 emoji 图标、无紫粉渐变、状态色沿用现有 SubagentsPanel 模式
