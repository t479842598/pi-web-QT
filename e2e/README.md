# CI and browser regression tests

Adapted from @Nuctori's CI/E2E proposal in #617 and #599. The performance
scanner, reverse reader, sidebar changes, and timing benchmarks are not included.

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

The script starts and stops its own Turbopack dev server on an available
loopback port. Run it in a checkout without an active dev server; Next.js
shares `.next/dev/lock` within a checkout. All fixtures are created before
startup in a temporary `PI_CODING_AGENT_DIR` and removed on completion.
No model credentials or existing Pi sessions are needed.

CI runs lint, type checking, and unit tests in one job. A separate job builds
the application in a clean checkout and runs the same browser tests with
`E2E_SERVER_MODE=start` against `next start`. Do not build in a checkout used
for development.

Coverage:

- A 5,000-message session opens with exactly the last 50 entries, bounded
  detail/context responses, and no browser errors.
- Desktop and mobile scrolling load two consecutive older pages. Each response
  has the expected IDs, no gaps or duplicates, and the messages appear once in
  the chat. A small session checks pagination through the root.
- Branch context follows the selected leaf and excludes the other branch.
- Markdown, code blocks, and real tool-call/tool-result blocks render.
- Chat width and font size persist, existing drafts resize, and short settings
  panels keep every language option reachable on desktop and mobile.
- Unknown sessions and paths outside the fixture project are rejected.
- A local extension checks dialog keyboard navigation, Esc cancellation,
  collapse/expand draft preservation, countdown display, and server-side expiry.

Model prompts, live model streaming, and agent execution are outside this suite.
Failures save a screenshot, Playwright trace, and server log under
`test-results/e2e/`; CI uploads that directory. Open a trace with
`npx playwright show-trace test-results/e2e/trace.zip`.

## Isolated virtual-list layout regression

```sh
node e2e/chat-layout-server.mjs
```

Open the loopback URL printed by the command. This fixture bundles the actual
`VirtualizedMessageList` and `MarkdownBody` with production React into memory;
it neither starts Next.js nor reads session files, model credentials, or `.next`.
It uses synthetic messages and the list-related content-visibility rules from
`app/globals.css`.

Use the controls to grow text, expand a row, toggle streaming, change the column
width, add an extension header, and prepend older messages. `检查布局` reports
mounted row count and any overlapping adjacent row borders. With the top row in
view, `headerOffset` should remain zero even with the header enabled. Expansion
must also settle after returning from a background tab without switching chats.

Stop the fixture with Ctrl+C and close its browser tab after testing. It is a
focused component regression, not a replacement for full application or native
WebView smoke tests. The older `run.mjs` pagination sentinel assertions still
need adaptation to the virtualized message list before that suite can block CI.
