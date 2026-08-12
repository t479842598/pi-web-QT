# Pi Mobile

[English](./README.md) | [日本語](./README.ja.md)

Pi Mobile 是 [Pi Web](https://github.com/t479842598/pi-web-QT) 仓库自带的 Flutter 原生客户端（Android / iOS / iPad）。功能、使用与安全说明见仓库根 [README](../README.md) 的「原生移动客户端」一节。

## 本地构建

在仓库根目录执行（当前工作目录为 `mobile/`）：

```bash
cd mobile
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
flutter build apk --release      # Android APK
flutter build appbundle --release  # Android AAB
flutter build ios --release --no-codesign  # iOS 未签名 IPA
```

- APK 输出：`mobile/build/app/outputs/flutter-apk/app-release.apk`
- iOS IPA 未签名，需用 AltStore / Sideloadly 自签后安装

## 自动发布

仓库打 `v*` tag 时，GitHub Actions（`.github/workflows/mobile-release.yml`）自动产出 Android APK/AAB 与 iOS 未签名 IPA 并挂到同名 GitHub Release。详见根 README 与 [docs/release.md](../docs/release.md)。

Android 签名：本地或 CI 通过 `mobile/android/key.properties` 读取密钥（密钥文件与密码不提交仓库），见 [SIGNING.md](./SIGNING.md)。
