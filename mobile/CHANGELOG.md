# Changelog

## 1.2.0 - 2026-08-13

- Live working panel in the chat stream now matches the web client: real-time
  tool cards (name, argument preview, duration, running/done/error state),
  agent phase line (waiting for model / running command / running tools),
  live thinking, and streaming text.
- Historical tool calls render as collapsible cards with full JSON arguments
  instead of a plain text line.
- Slash command palette view toggle (compact chips ↔ grouped list).

## 1.1.0 - 2026-08-11

- Added an app language setting under Features & display.
- Supports Simplified Chinese, Japanese, and English with immediate switching.
- Follows the Android system language by default and falls back to English when unsupported.

## 1.0.0 - 2026-08-11

- First open-source release of Pi Mobile.
- Android client for self-hosted Pi Web servers.
- Conversation, model, skill, directory, image, theme, and slash-command support.
- Fixed `pi` username with optional password support for unprotected Pi Web servers.
- Automatic updates, update-server configuration, APK installation, telemetry, and analytics are not included.
