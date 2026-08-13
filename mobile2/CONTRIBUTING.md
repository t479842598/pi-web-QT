# Contributing

Thank you for helping improve Pi Mobile.

## Development

1. Install Flutter, Android SDK, and JDK 17.
2. Run `flutter pub get`.
3. Make focused changes without adding credentials, server addresses, signing keys, or generated APK files.
4. Before opening a pull request, run:

```bash
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
```

Please explain the user-visible behavior, testing performed, and any Pi Web API compatibility considerations in the pull request.
