# Pi Web

[中文文档](./README.md)

**A web workspace for the Pi coding agent.** Pi Web reads the Pi sessions on the host and provides real-time chat, project browsing, model configuration, skills, plugins, Git worktrees, and a responsive mobile interface. This repository ships the web service only; it does not include an Electron desktop application or release packaging.

![Pi Web workspace](./docs/screenshots/web-workspace.png)

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
