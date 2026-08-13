# Pi Web New（mobile2/）— Flutter 移动端新版

基于 [`mobile/`](../mobile/) 演进的新版 Flutter 客户端，独立发布，与旧版共存安装。

| | 旧版 mobile/ | 新版 mobile2/ |
|---|---|---|
| 打包名 | `pi-web` | `pi-web-new` |
| 显示名 | Pi Web | Pi Web New |
| Android 包名 | `top.zknas.pi.pi_mobile` | `top.zknas.pi.pi_mobile_new` |
| iOS Bundle ID | `com.pimobile.piMobile` | `com.pimobile.piMobileNew` |

## 功能

与 mobile/ 一致（连接自建 Pi Web、多服务器切换、SSE 流式对话、思考级别、goal/plan、三语等），在此基础上继续演进（MonkeyCode 风格改造：GlassDock 三 Tab 导航、任务列表、项目页、聊天信息栏等）。

## 构建与打包

```bash
cd mobile2
flutter pub get
flutter build apk --release          # Android APK
flutter build appbundle --release    # Android AAB
flutter build ios --release --no-codesign   # iOS（自签 IPA，见 mobile/README.md 打包说明）
```

正式发布由 GitHub Actions 统一打包：打 `v*` tag 触发 [`release-all.yml`](../.github/workflows/release-all.yml)，产出 `pi-web-new-*.apk/.aab/.ipa`。版本号跟随 web（`node ../scripts/sync-version.mjs` 同步）。
