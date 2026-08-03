# 移动端布局

## 顶栏

- `<=640px` 隐藏会话标题、历史、自动命名、分支与系统提示的顶栏组合，避免在单行顶栏中与侧栏、语言、文件、主题和设置图标竞争宽度。
- 历史、分支和系统提示仍可从会话信息条访问；顶栏不换行。
- 隐藏固定在右上角的重复文件面板按钮，移动端仅保留标题栏内的文件面板入口。`<=380px` 时同时收起顶栏会话统计图标。

## 侧栏与安全区

- 移动侧栏采用 `sidebar-main` 与 `sidebar-footer` 的弹性高度分配：会话/文件列表在可压缩主区滚动，Models、Skills、Plugins 固定在底部。
- 底栏使用 `max(8px, env(safe-area-inset-bottom))`，确保 Safari 地址栏变化和带 Home Indicator 的设备上仍可点击。
- 根侧栏和会话内容均使用 `min-height: 0` 与 `overflow: hidden`，避免 `height: 100%` 的列表挤出 footer。

## 验证

- `components/MobilePwaLayout.test.mjs` 覆盖顶部控件收起、侧栏弹性主区与 footer 安全区。
- 运行中的 Next dev 服务由 `pi-web` 启动器直接指向工作区，可在浏览器热更新后检查 390px 与 320px 视口。
