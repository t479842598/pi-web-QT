# 工作区表面主题对齐

本批保持项目选择、会话树、Git Changes、文件 Diff、文件预览和标签操作不变，只把工作区的状态色收口到主题 token。

- 文件 Diff 使用 `--diff-added` / `--diff-removed`；
- 文件监听、上传成功、刷新完成使用 `--status-success`；
- 文件加载、上传与预览错误使用 `--status-error`；
- Git modified/added/deleted/renamed/untracked/conflict 使用对应状态或强调 token；
- 未选择项目的侧栏和完成反馈使用当前主题的 accent/status token。

没有替换 `SessionSidebar`、`FileExplorer`、`FileViewer` 或 `TabBar` 的结构，因为当前项目额外承载运行态轮询、Git Changes 独立列表、工作区切换、source/preview/diff 模式、文件刷新与中键关闭等功能。相关 API 调用与事件链保持原样。

验证：

```bash
node --experimental-strip-types --test components/SessionSidebar.test.mjs components/MessageView.test.mjs components/ChatInput.test.mjs components/ChatInput.dormancy.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```
