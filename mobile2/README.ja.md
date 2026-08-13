# Pi Mobile

[English](./README.md) | [简体中文](./README.zh-CN.md)

Pi Mobile は [Pi Web](https://github.com/t479842598/pi-web-QT) リポジトリに同梱される Flutter ネイティブクライアント（Android / iOS / iPad）です。機能・利用方法・セキュリティについては、リポジトリルートの [README](../README.md) の「原生移动客户端」セクションを参照してください。

## ローカルビルド

リポジトリルートで実行します（作業ディレクトリは `mobile/`）：

```bash
cd mobile
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
flutter build apk --release      # Android APK
flutter build appbundle --release  # Android AAB
flutter build ios --release --no-codesign  # iOS 未署名 IPA
```

- APK 出力：`mobile/build/app/outputs/flutter-apk/app-release.apk`
- iOS IPA は未署名のため、AltStore / Sideloadly で自己署名してインストールします

## 自動リリース

リポジトリに `v*` タグをプッシュすると、GitHub Actions（`.github/workflows/mobile-release.yml`）が Android APK/AAB と iOS 未署名 IPA を自動ビルドし、同名の GitHub Release に添付します。詳細はルート README と [docs/release.md](../docs/release.md) を参照してください。

Android 署名：ローカルまたは CI で `mobile/android/key.properties` からキーを読み取ります（キーファイルとパスワードはリポジトリにコミットしません）。詳細は [SIGNING.md](./SIGNING.md) を参照してください。
