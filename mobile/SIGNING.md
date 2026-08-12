# Android release signing

Public releases should use one stable signing key. Losing the key prevents users from installing future versions over an existing installation.

Create `android/key.properties` locally (the file and all `*.jks` / `*.keystore` files are ignored):

```properties
storePassword=change-me
keyPassword=change-me
keyAlias=pi-mobile
storeFile=/absolute/path/to/pi-mobile-release.jks
```

Then run `flutter build apk --release`. Without this file, the project intentionally falls back to the local Android debug key for development builds.

Never commit, upload, or paste the keystore or its passwords into an issue, log, source file, or release note. Keep an encrypted offline backup.

## CI signing (GitHub Actions)

The `mobile-release` workflow signs Android builds from repository secrets. Configure these in **Settings → Secrets and variables → Actions**:

- `ANDROID_KEYSTORE_BASE64` — base64 of the release keystore (`base64 -i pi-mobile-release.jks | pbcopy`)
- `KEYSTORE_PASSWORD` — store password
- `KEY_PASSWORD` — key password
- `KEY_ALIAS` — key alias

The workflow materializes `android/key.properties` from these at build time and never stores the keystore in the repository. iOS builds are intentionally unsigned.
