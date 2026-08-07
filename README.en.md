# Pi Web

[中文文档](./README.md)

**A web workspace for the Pi coding agent.** Pi Web reads the Pi sessions on the host and provides real-time chat, project browsing, model configuration, skills, plugins, Git worktrees, and a responsive mobile interface. This repository ships the web service only; it does not include an Electron desktop application or release packaging.

![Pi Web workspace](./docs/screenshots/web-workspace.png)

<p align="center">
  <img src="./docs/screenshots/mobile-web.png" alt="Pi Web mobile interface" width="320" />
</p>

## Features

- Live Pi Agent responses through SSE, including tool calls and reasoning status.
- Project-scoped session browsing, forks, in-session branches, rename, delete, and HTML export.
- A browsable folder picker for loading a project without manually entering a path.
- File explorer and preview for source, diffs, images, audio, PDF, and DOCX files.
- Model, OAuth/API-key, skill, plugin, theme, language, and Git worktree management in the browser.
- Task board (Beta, desktop only): four-column kanban that runs each task as an agent in its own git worktree branch, with review, merge, archive and per-project settings.
- Mobile layout keeps the selected model and send action visible, while long project and repository labels truncate instead of causing horizontal scrolling.

## Task board (Beta)

On desktop, click the board button (four-square icon) in the title bar to toggle between chat and the task board. The board turns "delegate work to an agent" into a trackable pipeline: create → start → run → review → merge → done.

### Status columns

| Column | Statuses | Meaning |
| --- | --- | --- |
| Todo | `todo` | Created, waiting to start |
| In progress | `queued` / `preparing` / `running` | Queued, setting up the worktree, agent running |
| Attention | `awaiting_input` / `review` / `merging` / `failed` | Needs you: waiting for input, review, merging, failed |
| Done | `done` / `canceled` | Finished or canceled (canceled hidden by default, toggle in Filter) |

### Workflow

1. **New task** — pick a project, write a title and a prompt (task description). Save recurring prompts as templates.
2. **Start** — click **Start** on the card; the engine creates a dedicated branch (`task/<id>-<slug>`) under the project's `-worktrees` directory and runs the agent there. You can also drag a todo card onto the **In progress** column to start it, or use **Start all** to queue every todo of the project.
3. **Running / cancel** — cancel anytime while running; tasks that need your input flip to *awaiting input*.
4. **Review** — when the agent finishes, the task moves to **Attention** (a red badge appears in the board title; a system notification fires while the window is inactive). Open the detail drawer to inspect changed files, diffs and the full timeline; projects with a preflight command show an acceptance red/green light.
   - **Merge** — accept the result (auto or manual commit message; optionally delete the worktree). The agent merges inside its session; the task then lands in **Done**.
   - **Return** — send it back with feedback to keep working.
5. **Archive** — archive finished/failed/canceled tasks (hidden by default, toggle in Filter); **Archive all** clears the Done column.
6. **Failures** — failed tasks show the error; **Retry** relaunches on a new run generation, or **Edit** then restart; canceled tasks can be **re-queued**.

### Task settings

The board's own **Task settings** button configures per-project execution (separate from the main Settings modal):

| Setting | Meaning |
| --- | --- |
| Auto-process queued tasks | Start tasks as soon as they are queued |
| Max concurrent tasks | Per-project execution limit (0 = unlimited) |
| Merge strategy | Merge commit or squash |
| Delete worktree after merge (default) | Auto-clean worktree + branch after merge |
| Preflight command | Command run in the worktree before review (acceptance check, e.g. `npm test`) |
| Init command | Command run in the worktree before the agent starts (e.g. `pnpm install`) |
| Stage prompts | Extra instructions per stage: work / retry / return / merge |

### Notes & limits

- Tasks are stored under `~/.pi/agent/tasks/` (JSONL, atomic writes); task sessions live with your other sessions and are browsable from the sessions list.
- Each task runs in its own git worktree branch; task agents are explicitly constrained not to commit/push other branches or checkouts.
- The engine is a single server process (exclusive lock); interrupted tasks are recovered on restart (marked failed/interrupted, retryable).
- Beta: desktop only; the mobile UI does not show the board.

## Latest changes (2026-08-07 · v0.9.17 stable)

- **Windows session import no longer unrecognized**: Reasonix data roots now span both `%APPDATA%/reasonix` (Windows desktop v1.x / Go/Wails layout) and `~/.reasonix` — `reasonixHomeDirs()` dedupes candidates, projects + flat sessions layouts are scanned across roots and merged. Verified 43 discoverable sessions on Windows; mac/CLI layouts are unaffected.
- **Pi upgraded to 0.84.0**: all four `@earendil-works/pi-*` packages 0.83.0 → 0.84.0 (synced with upstream agegr/pi-web v0.8.7), adapting 0.84's `Theme` constructor and `apiKeyAuth.login(signal)` API.
- **Per-session mode/policy isolation**: task mode, token profile, tool approval and permission rules are now saved per conversation — new chats inherit globals, existing chats keep their own settings, switching chats no longer overwrites each other (new `modesPerSession` in settings.json; old sessions fall back to the global default automatically).
- **display math normalization** (upstream #332): multi-line formulas, formulas inside nested lists, and glued `$$` delimiters no longer swallow following text or render as KaTeX error blocks.
- **Edit message restores images** (upstream #336): “Edit here” now fills both text and images back into the composer — images become pending attachments again.
- **Follow-scroll polish** (upstream #333): streaming only auto-follows while near the bottom; scrolling up to read history is no longer yanked by streaming output.
- Version now leaves beta (stable).

## Previous changes (2026-08-07 · v0.9.17-beta.3)

- **Zero install-time warnings**: provider icons are now inlined components, so `@lobehub/icons` is gone and npm no longer auto-installs the `@lobehub/ui` / `antd` / `@emoji-mart/react` chain — no more `ERESOLVE overriding peer dependency` and `deprecated intersection-observer` warnings during install (see "npm 11 install notes").
- **undici fix now runs at runtime**: the `postinstall` hook is gone; `pi-web` applies the undici CVE fix at startup and `dev`/`start` scripts apply it before launching, so installing no longer requires approving install scripts.
- **Title generation no longer times out (524)**: generating a title while the session is still running waits at most 10s for idle then snapshots the current conversation; the model call timeout is tightened to 80s, keeping the total comfortably under the Cloudflare 100s gateway timeout.
- **Default mode is now Normal**: new chats default to Normal task mode instead of inheriting Plan.
- **Task board toggle takes effect immediately**: turning the task board on/off in Settings > Features syncs the toolbar entry and board view without a page refresh.
- **settings.json concurrency protection**: the modes, features, and title-model modules now share one file lock (proper-lockfile + atomic writes), so concurrent saves can no longer overwrite each other and drop config.
- **Default mode settings UI**: Settings > Features can now set the default task mode (Normal / Plan / Goal), token profile (Lite / Balanced / Delivery, default Balanced) and tool approval (Ask / Auto / Yolo); already-open chats apply the changes immediately and new chats inherit them.
- **SPA navigation robustness**: switching projects via the address bar (`?session=` ↔ `?cwd=`) is honored without a full reload; a brand-new project folder with no sessions yet stays in the project list; created sessions appear in the sidebar promptly.

## Previous changes (2026-08-06 · v0.9.17-beta.2)

- **Chat mode system** (ported from Reasonix): the composer toolbar gains three mode controls — task mode (Normal / Plan / Goal), token profile (Lite / Balanced / Delivery) and tool approval (Ask / Auto / Yolo). Plan mode produces a read-only plan then shows a confirm card (Execute / Suggest / Exit); Goal mode auto-continues with a turn budget and stall detection; Lite narrows the toolset to save tokens; Delivery injects a verify-first instruction.
- **Tool-call approval (real interception)**: in Ask mode, write-class tool calls are suspended before execution and a shelf card appears above the composer — allow, deny, or deny with a reason; parallel batches resolve one by one; 120s timeout auto-denies. Rules (deny > ask > allow) support `ToolName` / `ToolName(glob)` / `Bash(command:*)` and persist to `~/.pi/agent/settings.json`.
- **Yolo red ring**: picking Yolo tints the composer border red as an "unrestricted" warning.
- **Long-paste folding**: pasting >2000 chars / 20 lines collapses into a `[Pasted text #N · X lines]` card (preview / remove) so the composer stays fast; the full text is expanded when sending.
- **Title-failure bubble + model picker**: failed title generation shows a floating bubble next to the session row with retry and a provider-grouped model picker.
- **Fixes**: Markdown hydration errors (rehypeRaw removed), mode-instruction blocks no longer leak into user bubbles, batch title 500 / UI stall, model-picker duplicate keys and grouping, Windows import path mapping, idempotent approval resolves, and the mobile title bar (branch icon only + tap title for full text).

## Previous changes (2026-08-06 · v0.9.17-beta.1)

- **Fix 500 when generating titles for imported sessions** — auto-naming Reasonix-imported sessions no longer fails with `Cannot read properties of undefined (reading 'length')`. The import converter could emit text blocks missing the `text` field; both the importer and the title pipeline now handle this, including previously imported files.
- **Faster title generation** — very long sessions (thousands of tool messages) now use only the most recent portion of the conversation, avoiding timeouts; falls back to the full transcript when the tail has no user message.
- **Batch title generation** — a new "Generate titles" button in the session list header names all sessions in the current project in parallel with live progress, then refreshes automatically.
- **Parallel title generation after import** — the import-complete "generate titles" action now runs concurrently instead of serially with 500ms pauses; individual failures are skipped without affecting the rest.

## Latest changes (2026-08-05)

- **Task board (Beta, desktop)** — a new title-bar button toggles a four-column kanban (Todo / In progress / Attention / Done) that runs each task as an agent in its own git worktree branch: drag-to-start, detail drawer (timeline / diff / changed files), review & merge, return with feedback, archive, task templates, per-project task settings (concurrency / merge strategy / preflight / init command / stage prompts), system notifications, and full i18n + theme support. Tasks are stored under `~/.pi/agent/tasks/` (JSONL).
- **Builtin model config persistence fix** — edits to builtin provider models (context window / max output / reasoning / thinking map / name / hidden) now persist as field-level `modelOverrides` instead of whole-model replacement entries, so untouched fields are never reset. All `models.json` mutations are serialized behind a file lock with atomic writes; local saves and the global Save button can no longer overwrite each other.
- **Draft protection** — switching providers, clicking the global Save, or closing Settings first flushes pending builtin model edits; on failure the draft is kept and an error is shown instead of silently dropping changes. Historical `models[]` configs remain supported with custom/transport fields preserved.

## Latest changes (2026-08-04)

- **Backup & restore** — a new Backup tab in Settings exports/imports core config, skills, plugins, MCP servers, and sessions (optionally including API keys) as a pi-backup zip; imports remap paths and adapt MCP commands per platform, with per-category selection and per-server skip.
- **Auto session titles** — hover actions on a session now include a "Generate title" button that names the session from its content via a model; the title model can be set globally.
- **Security hardening** — auth checks were added to the auto-name, settings/title-model, models-config, and builtin-model routes; backup import gained decompression-bomb limits (per-entry and total, verified against actual bytes), script shebang allow-lists, local-package name validation, and opt-in npm reinstall.
- The repository now uses the `pi-web-desktop` web baseline only. Electron, desktop packaging, the PWA Service Worker, and tag-triggered desktop releases were removed.
- **Choose folder** opens a browsable directory picker instead of asking for a manually typed path.
- On mobile, project and Git worktree labels are smaller and truncate safely; the model selector and send action remain visible.
- Expanding a provider in the model selector keeps the dropdown frame fixed and scrolls only the result list.
- Display settings again include the fixed QT palettes: Gruvbox, Nord, Tokyo Night, Solarized, One Dark, Dracula, and Catppuccin. They coexist with Pi JSON themes and support light, dark, and system modes.
- The mobile composer is now 52px high. It keeps a 16px input font to prevent iOS Safari zoom, while tighter line height and letter spacing make the text read smaller.
- Production serving no longer relies on Turbopack development chunks, and quoteable Markdown table rows render with valid table DOM.

## npm 11 install notes

Since **v0.9.17-beta.3** the `ERESOLVE overriding peer dependency` and `deprecated intersection-observer` warnings are gone: provider icons are inlined (no more `@lobehub/icons`, so npm no longer auto-installs the `@lobehub/ui` / `antd` / `@emoji-mart/react` chain). Two **informational** warnings may remain — both harmless:

- `deprecated node-domexception`: pulled in transitively by `@google/genai` → `google-auth-library` → `fetch-blob`. It is a polyfill for older Node versions; Node ≥ 18 ships `DOMException` natively, so it is unused at runtime. It cannot be removed from the package side until the upstream fix lands.

- `allow-scripts`: npm ≥ 11.16's install-script approval notice (`@google/genai` / `protobufjs` / `sharp` etc. transitive lifecycle scripts). Current versions only warn (scripts still run); future versions may block by default. To clear the notice in your project:

  ```bash
  npm approve-scripts --allow-scripts-pending   # view pending list first
  npm approve-scripts @google/genai protobufjs sharp   # approve and write to your package.json
  ```

  Or declare in your project `package.json`:

  ```json
  "allowScripts": {
    "@google/genai@1.52.0": true,
    "protobufjs@7.6.5": true,
    "sharp@0.34.5": true
  }
  ```

  Note this field matches `package@exact-version`; update it after version bumps.

## Requirements

- Node.js **22.19.0 or newer**
- A configured Pi model/provider credential

## Run from source

```bash
git clone https://github.com/t479842598/pi-web-QT.git
cd pi-web-QT
npm ci
npm run dev
```

`npm run dev` uses a **random port** (`-p 0`); the startup log prints the actual address, e.g. `http://127.0.0.1:<random port>`. The local repo build is for testing only — for daily command-line use, run the globally installed `@qt4798/pi-web` via the `pi-web` command (fixed `http://127.0.0.1:30141`). The development server listens on loopback by default; use `npm run dev:lan` only for trusted LAN testing.

## Production deployment

See [docs/deployment.md](./docs/deployment.md) for the complete deployment guide. The smallest production flow is:

```bash
npm ci
npm run build
PI_WEB_PASSWORD='replace-with-a-random-password' \
PI_WEB_ALLOWED_HOSTS='piweb.example.com' \
node bin/pi-web.js -H 127.0.0.1 -p 30141 --no-open
```

| Variable | Purpose |
| --- | --- |
| `PI_WEB_PASSWORD` | Enables HTTP Basic Auth. The username is `pi`. |
| `PI_WEB_ALLOWED_HOSTS` | Comma-separated external hostnames, such as `piweb.example.com`. |
| `PI_CODING_AGENT_DIR` | Uses another Pi agent data directory instead of `~/.pi/agent`. |
| `PI_WEB_NO_OPEN=1` | Prevents the CLI from opening a browser after startup. |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Configures proxy behavior for server-side model/API requests. |

Keep the Node service on `127.0.0.1` and publish it through an HTTPS reverse proxy, Caddy, Nginx, or Cloudflare Tunnel.

## Folder picker and mobile UI

- Select **Choose folder** in the sidebar, browse into a directory, then select that directory to load it as the workspace.
- On mobile, the current model and send button stay visible; thinking, tools, compaction, and sound controls remain under **More**.
- Opening or closing a provider group in the model selector keeps the dropdown frame fixed and scrolls only its result list.

## Development checks

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```

Do not run `npm run build` during local development: it rewrites `.next/` and can disrupt `npm run dev`. Use builds for production deployment or CI.

## License

[MIT](./LICENSE)
