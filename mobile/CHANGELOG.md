# Changelog

## 1.3.0 - 2026-08-14

- Fixed the chat input and + button becoming permanently unresponsive when the
  SSE stream silently stalled (mobile NAT black-holing): a reconcile watchdog
  now probes `GET /api/agent/[id]` every 5s while a run is active, recovers on
  app resume, and resets the run state within seconds of a missed terminal event.
- The + button is now a five-item menu: Plan mode, Goal mode, Upload file,
  Use command, and Reference conversation.
- Web theme system: pick any server theme (gruvbox, nord, tokyo, solarized,
  onedark, dracula, catppuccin, …) from the function drawer; the app palette
  follows the web client's CSS variables (light + dark variants).
- Visual alignment with the web client's default theme: teal accent, web
  user/tool bubble colors, 85% user bubble width with 300px internal scroll,
  rounded 9px user bubbles.
- Session drawer: project notes (备注) from the web client are displayed and
  editable; projects and sessions with an active run float to the top.
- Provider management: list API-key providers, add/update/remove keys.
- @ file references and # snippet autocomplete in the composer.
- Thinking level selector (off … max) in the function drawer.
- While the agent is running, the composer now sends as a steer (tap) or a
  follow-up (long-press); queued messages show a badge.
- Goal collaboration mode: set a goal, live status banner with pause / resume /
  stop controls.
- Upload files: images join the attachment pipeline; text files are injected
  into the composer (≤512KB, truncated at 20k chars).

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
