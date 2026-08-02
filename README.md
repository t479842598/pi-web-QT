# Pi Web (pi-web-QT)

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Local web UI for the [pi coding agent](https://github.com/badlogic/pi-mono). Pi Web reads your local pi session files and gives you a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

This fork is based on [agegr/pi-web](https://github.com/agegr/pi-web) **v0.8.6** and adds a set of UX fixes and enhancements (scroll behavior, mobile usability, math/Mermaid rendering, file handling, queue persistence, usage statistics, quote-reply, and more). See [Changes in this fork](#changes-in-this-fork) below for the full list.

![Pi Web shows the same pi session with structured Markdown, tool calls, and project navigation beside the CLI](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

The same pi session in CLI and Pi Web: structured tool calls, readable Markdown, session browsing, and cleaner results.

## Quick Start

Pi Web requires Node.js 22.19.0 or newer. Check your version with `node --version`.

**Run without installing:**

```bash
npx @agegr/pi-web@latest
```

**Or install globally:**

```bash
npm install -g @agegr/pi-web
pi-web
```

Then open [http://127.0.0.1:30141](http://127.0.0.1:30141). The CLI will try to open the browser automatically after the server is ready. Pi Web listens on `127.0.0.1` by default.

**Options:**

```bash
pi-web --port 8080              # custom port
pi-web --hostname 0.0.0.0       # expose on a trusted network
pi-web -p 8080 -H 0.0.0.0       # combine options
pi-web --no-open                # do not open the browser automatically

PORT=8080 pi-web                # environment variable is also supported
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # explicit network exposure
PI_WEB_ALLOWED_HOSTS=pi-web.internal pi-web  # allow an exact proxy/custom hostname
PI_WEB_PASSWORD='a-long-random-password' pi-web  # require Basic Auth (username: pi)
PI_WEB_NO_OPEN=1 pi-web         # useful when running as a background service
```

Set `PI_WEB_PASSWORD` to protect the web interface and every API endpoint with HTTP Basic Auth. The username is always `pi`. Leaving the variable unset or empty disables authentication.

Pi Web can invoke a high-privilege agent. Basic Auth does not encrypt the password in transit, so do not expose plain HTTP to the internet. Use HTTPS through a trusted reverse proxy or a trusted VPN for remote access.
API requests accept loopback names, IP literals, the selected bind hostname, and exact comma-separated names in `PI_WEB_ALLOWED_HOSTS`. Configure that variable when a trusted reverse proxy uses a different external hostname.

## HTTP Proxy

Pi Web reads the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables for server-side model and API requests.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Features

- **Pick work back up**: browse previous pi conversations by project without digging through terminal history or session paths.
- **Try different directions safely**: continue from an earlier message or fork a session into a separate route.
- **Work across branches**: switch Git worktrees from the sidebar so new sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source, docs, images, audio, and PDFs on the right while the agent works.
- **See session state clearly**: context usage, cost, compaction state, and system prompt details are visible from the top bar.
- **Configure less from the terminal**: manage models, login/API keys, model tests, and skill switches from the web UI.
- **Use the interface in your language**: switch between the supported UI languages from the top bar.

## Changes in this fork

Based on upstream `agegr/pi-web` v0.8.6, with the following fixes and enhancements merged and verified locally:

### Core UX fixes

- **Scroll-to-bottom blank space fixed** — the full-viewport blank spacer that was inserted at the bottom of the message list while the agent runs is replaced with a compact 52px spacer (input area height). Scrolling to the bottom now lands on the actual latest message instead of a full screen of blank space.
- **Live-follow streaming output** — while the agent is streaming, the view auto-scrolls to follow new output only when you are already near the bottom (within 150px). If you scrolled up to read history, the view stays put and is never yanked back down.
- **Mobile input zoom fixed** — iOS Safari auto-zooms the page when an input with a font-size below 16px gains focus. The chat textarea now uses 16px on mobile, and a global `@media (max-width: 640px)` rule forces 16px on all `input`/`textarea`/`select` elements as a safety net.

### Message & Markdown rendering

- **Slash-command / skill messages collapse** — `/skill:name` and template messages that pi expands into full skill instructions are now shown as a compact clickable command chip (command name + your arguments), with the expanded body hidden behind a toggle. `lib/slash-display.ts` reverse-matches skill expansions in both live SSE events and loaded session history without mutating SDK-shared message objects.
- **Display math `$$...$$` no longer swallows following text** — `normalizeDisplayMath` keeps content lines indented together with their `$$` fences so formulas nested in list items or glued to surrounding text parse correctly (remark-math "lazy continuation" guard).
- **Math formulas render in the chat minimap outline** — headings containing KaTeX formulas no longer show raw LaTeX in the minimap outline.
- **Mermaid diagrams render with zoom & pan** — mermaid code blocks render as an interactive preview by default; the new `ZoomPanViewer` supports zoom in/out, drag-pan, select-text mode, and full reset. Works on desktop and mobile.

### File handling

- **AI-generated local file links are actionable** — local file paths in assistant messages render as clickable file links with a file-type icon; clicking downloads or opens the file. Supports relative paths, Windows paths, `file:///` URLs, Chinese filenames, and `path:line` references.
- **Drop any file into the chat input** — previously only images could be dragged in (other files silently did nothing). Now any file dropped into the chat input inserts a path/`@` reference to the file.
- **FileViewer unified @mention button** — a single @ mention button in the file viewer toolbar: with lines selected in source mode it inserts a line-range mention (`@path#Lstart-Lend`), otherwise a whole-file mention.

### Queue & session reliability

- **Queued messages persist across restarts** — steer/follow-up queues (which pi keeps in memory only) are mirrored to a per-session sidecar file (`<session>.jsonl.queue.json`, atomic write). After a server restart, orphaned entries surface in a recovery dialog where you decide to re-queue, discard, or export — nothing is delivered automatically.
- **Queue management & export** — the queued-message banner gains export (Markdown/JSON) and import, with `QueueRecoveryDialog` for reviewing pending entries. Streaming model/compact operations are supported from the queue.

### Statistics & QoL

- **Per-model token usage & cost statistics** — aggregates token usage and estimated cost across sessions, broken down per model, accessible from the sidebar. Answers "how much have I spent per model this week/month?" (`app/api/usage/route.ts` + `lib/usage-store.ts` + `components/UsageStats.tsx`).
- **Quote-reply popover** — hover (desktop) or click (mobile) any assistant paragraph, list item, or table row to pop a quote-reply popover. Closed questions get quick answer buttons (yes/no, A/B), and every block is quoteable via a fallback "quote reply" button that fills the input with a `> quote` (never sends — you pick prompt / steer / followUp).

## Notes

- **Data directory**: Pi Web reads `~/.pi/agent/sessions` by default. Set `PI_CODING_AGENT_DIR` to point at another pi agent directory.
- **Session files**: files are stored as `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Model config**: the Models panel reads and writes `models.json` in the pi agent directory. Model lists and defaults come from pi's config.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions.
- **Git worktrees**: see [Worktrees in Pi Web](./docs/worktrees.md) for when the switcher appears, how new worktrees are created, and what removal does.
- **Forks vs in-session branches**: Fork creates a new `.jsonl` file. "Edit from here" creates another branch inside the same session file.
- **Internationalization**: see [Internationalization](./docs/i18n.md) for using translations and adding languages or UI text.

## Development

```bash
npm install
npm run dev
```

The local dev server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141).

Common checks:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```

Avoid running `next build` / `npm run build` during local development. It writes to `.next/` and can interfere with the dev server; leave builds for release work.

## Project Structure

```text
app/
  api/
    agent/          # creates/drives AgentSession and exposes SSE events
    auth/           # OAuth and API key management
    cwd/browse/     # browsable server directory listing
    cwd/validate/   # custom working directory validation
    default-cwd/    # pi default working directory lookup
    files/          # file listing, reading, preview, and watching
    home/           # current user home directory
    models/         # available models, default model, thinking levels
    models-config/  # read/write models.json and test models
    sessions/       # session reads, rename, delete, context, HTML export
    skills/         # skill listing, search, install, enable/disable
    usage/          # per-model token usage & cost aggregation
components/
  AppShell.tsx        # main layout, URL state, top panels, file tabs
  SessionSidebar.tsx  # project selector, session tree, Explorer
  DirectoryPicker.tsx # browsable and editable working-directory picker
  ChatWindow.tsx      # messages, SSE, image drag/drop, minimap
  ChatInput.tsx       # input bar, model/tools/thinking/compact/slash controls
  MessageView.tsx     # message, thinking, tool call/result rendering
  ModelsConfig.tsx    # model and auth configuration panel
  SkillsConfig.tsx    # skill management panel
  FileExplorer.tsx    # file tree
  FileViewer.tsx      # source, diff, image, audio, PDF, DOCX preview
  UsageStats.tsx      # per-model usage/cost statistics panel
  QueueRecoveryDialog.tsx # queued-message recovery/export/import dialog
  QuoteReplyPopover.tsx   # quote-reply popover on assistant messages
  ZoomPanViewer.tsx       # zoom/pan viewer (Mermaid previews)
lib/
  directory-browser.ts # directory normalization and safe listing helpers
  http-dispatcher.ts  # HTTP(S) proxy setup for server-side fetch
  rpc-manager.ts      # AgentSessionWrapper lifecycle and global registry
  session-reader.ts   # parses .jsonl session files and branch contexts
  normalize.ts        # normalizes toolCall field names
  file-access.ts      # file read safety boundary
  file-paths.ts       # path encoding and relative path helpers
  markdown.ts         # Markdown/Mermaid/KaTeX plugin configuration
  pi-types.ts         # pi-related types
  slash-display.ts    # slash-command/skill expansion reverse-matching
  queue-store.ts      # durable queue sidecar (persist/recover steer & follow-up)
  queue-export.ts     # queue export (Markdown/JSON) and import parsing
  usage-store.ts      # per-model token usage & cost store
  quote-reply.ts      # quote-reply parsing/formatting helpers
  dropped-files.ts    # dropped-file path/reference helpers
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useAudio.ts         # completion sound
  useDragDrop.ts      # image/file drag/drop
  useTheme.ts         # theme switching
bin/
  pi-web.js           # npm CLI entrypoint
instrumentation.ts    # initializes the server HTTP dispatcher
```
