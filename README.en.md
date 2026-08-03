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
- Mobile layout keeps the selected model and send action visible, while long project and repository labels truncate instead of causing horizontal scrolling.

## Latest changes (2026-08-03)

- The repository now uses the `pi-web-desktop` web baseline only. Electron, desktop packaging, the PWA Service Worker, and tag-triggered desktop releases were removed.
- **Choose folder** opens a browsable directory picker instead of asking for a manually typed path.
- On mobile, project and Git worktree labels are smaller and truncate safely; the model selector and send action remain visible.
- Expanding a provider in the model selector keeps the dropdown frame fixed and scrolls only the result list.
- Production serving no longer relies on Turbopack development chunks, and quoteable Markdown table rows render with valid table DOM.

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

Open `http://127.0.0.1:30141`. The development server listens on loopback by default; use `npm run dev:lan` only for trusted LAN testing.

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
