# Release Checklist

This repo publishes two artifacts for each release:

- npm package: `@qt4798/pi-web`
- GitHub Release: `t479842598/pi-web-QT`

Use this checklist from a clean `main` checkout.

## 1. Preflight

```bash
git status --short --branch
git log --oneline --decorate -5
gh auth status
npm whoami
node -e "const p=require('./package.json'); console.log(p.version)"
```

Expected:

- `git status` is clean, or only contains changes you intentionally plan to release.
- GitHub is authenticated as an account that can push and create releases.
- npm is authenticated as an account that can publish `@qt4798/pi-web`.

## 2. Publish to npm

```bash
npm run release
```

The release script runs:

```bash
npm version patch --no-git-tag-version && npm run build && npm publish --access public
```

Notes:

- This bumps `package.json` and `package-lock.json`.
- It intentionally runs a production build. Do not run `next build` during normal development; release work is the exception.
- If `npm view @qt4798/pi-web version` briefly shows the previous version, check the exact version instead:

```bash
npm view @qt4798/pi-web@<version> version --registry https://registry.npmjs.org/
npm view @qt4798/pi-web versions --json --registry https://registry.npmjs.org/
```

## 3. Commit the Version Bump

Replace `<version>` with the new package version, for example `0.7.5`.

```bash
git diff -- package.json package-lock.json
git add package.json package-lock.json
git commit -m "Release v<version>"
```

## 4. Tag and Push

```bash
git tag -a v<version> -m "v<version>"
git push origin main --tags
```

Confirm the tag does not already exist before creating it when unsure:

```bash
git ls-remote --tags origin v<version>
gh release view v<version> --repo t479842598/pi-web-QT
```

## 5. Generate Release Notes from Commits

Use the previous release tag as the base.

```bash
git log --oneline --decorate v<previous>..v<version>
git log --format='%h%x09%s%n%b' v<previous>..v<version>
git diff --stat v<previous>..v<version>
```

Write the release notes from those commits, not from memory. Include both Chinese and English sections. Keep commit hashes next to each item when useful.

Suggested structure:

```markdown
## 中文

基于 `v<previous>..v<version>` 的提交整理。

### 新增

- ...

### 修复

- ...

### 改进

- ...

### 内部调整

- 发布 npm 包 `@qt4798/pi-web@<version>`。

## English

Prepared from commits in `v<previous>..v<version>`.

### Added

- ...

### Fixed

- ...

### Improved

- ...

### Internal

- Published npm package `@qt4798/pi-web@<version>`.
```

## 6. Create or Update the GitHub Release

> **更新日志（Release notes）**：README 不再内置更新日志。每个版本的更新日志只在此步写入 GitHub Release 的 notes（见下方 `--notes-file`）。写日志时聚焦该版本「新增 / 变更 / 修复」三类，中文与英文各一份；历史版本日志保留在已有 Release 的 notes 中，不复制回 README。

Create a new release:

```bash
gh release create v<version> \
  --repo t479842598/pi-web-QT \
  --verify-tag \
  --title "v<version>" \
  --notes-file release-notes.md
```

If the release already exists and only the notes need updating:

```bash
gh release edit v<version> \
  --repo t479842598/pi-web-QT \
  --notes-file release-notes.md
```

You can avoid a temporary file by passing notes through stdin:

```bash
gh release edit v<version> --repo t479842598/pi-web-QT --notes-file - <<'EOF'
## 中文

...

## English

...
EOF
```

## 7. Final Verification

```bash
gh release view v<version> --repo t479842598/pi-web-QT
npm view @qt4798/pi-web@<version> version --registry https://registry.npmjs.org/
git status --short --branch
git log --oneline --decorate -3
```

Expected:

- GitHub Release exists and is not a draft unless intentionally published as one.
- npm exact version resolves.
- `main` is aligned with `origin/main`.
- `HEAD` points at the release commit and `v<version>` tag.

## 7. Mobile artifacts (automatic)

Pushing the `v<version>` tag also triggers `.github/workflows/mobile-release.yml`, which builds the Flutter client in `mobile/` and attaches to the same release:

- `app-release.apk` and `app-release.aab` (Android)
- `*.ipa` unsigned (iOS, sideload via AltStore / Sideloadly)

The mobile version is derived from the tag (`v1.2.0` → `1.2.0+<build>`), independent of the web version. The workflow creates the release if it does not exist yet, so it works even when this manual flow runs first or last.

If the release already exists (created by this manual flow), the workflow uploads with `--clobber` and simply adds the mobile assets. No extra manual step is needed beyond pushing the tag.
