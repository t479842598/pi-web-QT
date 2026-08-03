# 进度日志

## 2026-08-03 - Task: 移植 pi-web-desktop v0.7.16 的 UI/UX 到当前项目

### What was done
将 pi-web-desktop（isWittHere fork）v0.7.16 的桌面 UI 增强移植到当前项目（@agegr/pi-web 0.9.0），共四大块：多步骤过程分组、统一设置弹窗、会话信息条、主题 JSON 兼容。Electron 打包体积优化经评估后暂缓（用户选择先完成 UI 迁移，提交 GitHub 由 Actions 打包）。

### Testing
- `tsc --noEmit` 全量通过
- `npm run lint` 0 errors 0 warnings
- `npm test` 全量 308 tests，307 pass；唯一失败为既有问题 `app/api/models-config/test/route.ts`（API 路由被 node --test 当测试文件执行，与本次改动无关，git diff 确认未触碰）
- 新增测试全过：`components/ProcessGroup.test.mjs`(6)、`lib/process-content.test.mjs`(4)、`app/api/theme-sets/theme-sets.test.mjs`(5)
- `npm run dev` 启动验证：首页 HTTP 200、`/api/theme-sets` 正常响应 `{"themeSets":[]}`

### Notes
改动文件清单：
- `components/ProcessGroup.tsx`（新）：多步骤过程分组组件（timeline/tabs 双模式、工具 tone 合并、文件标签、流式摘要）
- `components/ProcessGroup.test.mjs`（新）：ProcessGroup 源码级测试
- `lib/process-content.ts`（新）：消息块 → ProcessContentBlock 转换
- `lib/process-content.test.mjs`（新）：块转换测试
- `lib/step-categorizer.ts`（新）：工具调用语义 tone 分类
- `lib/step-visuals.ts`（新）：步骤图标/标签描述
- `hooks/useProcessDisplayMode.ts`（新）：timeline/tabs 模式偏好（localStorage 持久化）
- `components/SettingsModal.tsx`（新）：统一设置弹窗（chat/display 两个 tab）
- `components/ChatConfig.tsx`（新）：输入快捷键设置
- `components/SettingToggle.tsx`（新）：开关组件
- `components/DisplayConfig.tsx`（新）：显示设置（主题/自定义主题/亮暗/语言），轻量版适配当前 useTheme
- `components/SessionInfoBar.tsx`（新）：会话信息条（声音/历史/分支/系统提示/压缩/令牌/上下文 donut）
- `app/api/theme-sets/route.ts`（新）：读取 `~/.pi/agent/themes/` 列出 JSON 主题
- `app/api/theme-sets/theme-sets.test.mjs`（新）：主题分组逻辑测试
- `components/ChatWindow.tsx`：接入 ProcessGroup（历史段 + live tail）+ SessionInfoBar（ChatInput 下方两处）
- `components/MessageView.tsx`：导出 ThinkingBlock/ToolCallBlock，加 contentOnly/processStyle 扩展 props + ThinkingContentBody
- `components/AppShell.tsx`：接入 SettingsModal（顶栏齿轮按钮 + 弹窗）、给 ChatWindow 传新 props
- `components/BranchNavigator.tsx`：加 embedded prop（SessionInfoBar 兼容）
- `app/globals.css`：补派生 CSS 变量（--accent-blue/green/red、--bg-secondary/card）+ process/session-info-bar 样式
- `lib/i18n/messages/en.ts` / `zh-CN.ts`：新增 desktop.* key（process*/settings/sessionInfo 等）
- `package.json` / `package-lock.json`：新增 `@phosphor-icons/react` 依赖

回滚方式：本次改动全部为新增文件 + 对现有文件的增量修改，无数据库/配置迁移。回滚可 `git checkout -- <文件>` 还原 8 个修改文件，并删除 13 个新增文件（`git clean -n` 确认后 `git clean -f`）。
