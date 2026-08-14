# pi-web-qt（mobile2/）— Flutter 移动端

pi-web-qt 是 Pi Web 的唯一移动端客户端（Flutter），连接自建 Pi Web 服务，与网页端/桌面端同源。

| | 值 |
|---|---|
| 打包名 | `pi-web-qt` |
| 显示名 | pi-web-qt |
| Android 包名 | `top.zknas.pi.pi_web_qt` |
| iOS Bundle ID | `com.pimobile.piWebQt` |

## 功能

- 连接自建 Pi Web（URL + 密码）、多服务器切换
- SSE 流式对话、思考过程显示（横向块状）、工具调用卡片
- 会话列表：项目分组、备注名称、相对时间、消息数、git 分支、fork 标记
- 会话操作：重命名、置顶、删除、消息分叉（fork）
- 主题：网页端主题集同步 + 本地色板 + 全局字体大小调节
- Git Worktree、MCP 服务器管理、模型供应商、技能
- 三语（中/英/日）、iPad 宽屏布局

## 构建与打包

```bash
cd mobile2
flutter pub get
flutter build apk --release          # Android APK
flutter build appbundle --release    # Android AAB
flutter build ios --release --no-codesign   # iOS（自签 IPA）
```

正式发布由 GitHub Actions 统一打包：打 `v*` tag 触发 [`release-all.yml`](../.github/workflows/release-all.yml)，产出 `pi-web-qt-*.apk/.aab/.ipa`。版本号跟随 web（`node ../scripts/sync-version.mjs` 同步）。
