# 聊天消息与工具表面

## 对齐范围

本轮对齐保持聊天业务行为不变，只收口消息、工具结果、Diff、思考错误和会话信息栏的视觉 token：

- 助手流式消息使用 `is-streaming` class，使既有 `content-visibility` 优化不会作用于仍在增长的消息；
- 生成速率、图片边框、思考错误、工具展开边框、工具结果和补丁新增/删除状态使用主题语义 token；
- 底部 `SessionInfoBar` 恢复参考布局的容器与最大宽度约束，并保持扩展状态栏、分支、压缩、声音和会话统计行为不变；
- 上下文用量的警告/错误色使用 `--status-warning` / `--status-error`，因此随 Pi TUI 主题同步变化。

## 保留边界

未改动 MessageView 的 slash 命令折叠、图片/引用、复制、工具详情、Diff 解析；未改动 ChatWindow 的 SSE、队列、消息滚动；未改动 Minimap 算法或 Markdown 渲染插件。这样可复用 `pi-web-desktop` 的视觉层级，同时保留当前项目独有的会话与扩展能力。

## 验证

```bash
node --experimental-strip-types --test components/MessageView.test.mjs components/ChatInput.test.mjs components/ChatInput.dormancy.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

关键回归：流式助手消息应输出 `chat-assistant-message is-streaming`，工具/Diff/上下文状态应只引用 CSS token，SessionInfoBar 在常规聊天底栏应位于 `session-info-bar-wrap > session-info-bar-inner` 中。
