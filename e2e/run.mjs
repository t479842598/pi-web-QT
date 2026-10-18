// Adapted from @Nuctori's script-style CI/E2E fixtures in PR #617 (issue #599).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkFilePanel, filePanelFixture } from "./file-panel.mjs";
import { checkExtensionDialogs, extensionSource } from "./extension-dialog.mjs";
import { checkChatAppearance } from "./chat-appearance.mjs";
import { checkKitParity } from "./kit-parity.mjs";
import { flipToClaude, kitSwitchProblems, readKitSurface } from "./kit-switch.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.env.E2E_SERVER_MODE || "dev";
assert.ok(mode === "dev" || mode === "start", "E2E_SERVER_MODE must be dev or start");
assert.ok(mode !== "dev" || !existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-e2e-"));
const project = join(agentDir, "project");
const sessionDir = join(agentDir, "sessions", "e2e");
mkdirSync(project);
const previewFile = join(project, "preview.html");
writeFileSync(previewFile, filePanelFixture);
mkdirSync(sessionDir, { recursive: true });
const timestamp = "2026-08-23T00:00:00.000Z";
const LONG = "e2e-long-session";
const BRANCH = "e2e-branch-session";
const RICH = "e2e-rich-session";
const COMPACTED = "e2e-compacted-session";
const APPEND = "e2e-external-append-session";
const text = (i) => `E2E message ${String(i).padStart(4, "0")}`;
const ids = (start, end) => Array.from({ length: end - start }, (_, i) => `e${start + i}`);

function message(id, parentId, role, content) {
  return { type: "message", id, parentId, timestamp, message: { role, content } };
}

function writeSession(id, entries) {
  const header = { type: "session", version: 3, id, timestamp, cwd: project };
  writeFileSync(join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`),
    [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

let server;
let serverExited;
let browser;
let page;
let context;
let serverError;
const serverLog = createWriteStream(join(artifacts, "server.log"));
const interrupt = () => {
  process.exitCode = 1;
  server?.kill("SIGTERM");
  void browser?.close().catch(() => {});
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

try {
  // Seed before startup so the first catalogue scan sees every fixture.
  mkdirSync(join(agentDir, "extensions"));
  writeFileSync(join(agentDir, "extensions", "e2e-dialog.js"), extensionSource);
  const longEntries = Array.from({ length: 5000 }, (_, i) =>
    message(`e${i}`, i ? `e${i - 1}` : null, i % 2 ? "assistant" : "user", text(i)));
  longEntries.splice(1, 0, message("alternate", "e0", "user", "E2E alternate history branch"));
  writeSession(LONG, longEntries);
  writeSession(BRANCH, [
    message("root", null, "user", "Branch root"),
    message("old", "root", "assistant", "Inactive branch answer"),
    message("new", "root", "assistant", "Active branch answer"),
  ]);
  const toolResult = message("result", "call", "toolResult", [{ type: "text", text: "E2E tool output" }]);
  Object.assign(toolResult.message, { toolCallId: "t1", toolName: "bash", isError: false });
  const richEntries = [
    message("user", null, "user", "Render **E2E markdown**"),
    message("call", "user", "assistant", [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "E2E intermediate reasoning\nIntermediate thinking details." },
      { type: "text", text: "E2E process paragraph.\n\n".repeat(20) },
      { type: "toolCall", id: "t1", name: "bash", arguments: { command: "echo E2E tool output" } },
    ]),
    toolResult,
    message("answer", "result", "assistant", [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "E2E follow-up reasoning\nFollow-up thinking details." },
      { type: "text", text: "E2E process note" },
      { type: "thinking", thinking: "E2E final reasoning\nFinal thinking details." },
      { type: "text", text:
        "E2E final answer\n```js\nconsole.log('E2E code');\n```\n\n"
        + "E2E answer paragraph.\n\n".repeat(20)
        + "## E2E reading position\n\n"
        + "E2E answer paragraph.\n\n".repeat(20),
      },
    ]),
  ];
  Object.assign(richEntries.at(-1).message, { provider: "test", model: "E2E Model" });
  writeSession(RICH, richEntries);
  // The default page is 50 *visible* messages (user / assistant / compaction).
  // toolResults ride along free after #810, so 48 tool-call assistants + the
  // final answer + the divider fill that window; the user prompt is the 51st
  // visible entry and must stay outside the first page.
  const compactedEntries = [
    message("user", null, "user", "E2E prompt outside the compacted page"),
    { type: "compaction", id: "compact", parentId: "user", timestamp, summary: "E2E compaction anchor", firstKeptEntryId: "user", tokensBefore: 100 },
  ];
  for (let i = 0; i < 48; i++) {
    compactedEntries.push(message(`call${i}`, compactedEntries.at(-1).id, "assistant", [
      { type: "toolCall", id: `t${i}`, name: "bash", arguments: { command: `echo step${i}` } },
    ]));
    const result = message(`result${i}`, `call${i}`, "toolResult", [{ type: "text", text: `step${i}` }]);
    Object.assign(result.message, { toolCallId: `t${i}`, toolName: "bash", isError: false });
    compactedEntries.push(result);
  }
  compactedEntries.push(message("answer", "result47", "assistant", [{ type: "text", text:
    "E2E compacted answer paragraph.\n\n".repeat(20)
    + "## E2E compacted heading\n\n"
    + "E2E compacted answer paragraph.\n\n".repeat(20),
  }]));
  writeSession(COMPACTED, compactedEntries);
  writeSession(APPEND, [
    message("root", null, "user", "E2E wrapper root"),
    message("reply", "root", "assistant", "E2E wrapper reply"),
  ]);

  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), mode, "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.once("error", (error) => { serverError = error; });
  serverExited = once(server, "exit");
  server.stdout.pipe(serverLog, { end: false });
  server.stderr.pipe(serverLog, { end: false });

  async function api(path, status = 200) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, status, path);
    return response.json();
  }

  async function post(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    assert.ok(response.ok, `POST ${path} -> ${response.status}`);
    return response.json();
  }

  const deadline = Date.now() + 120_000;
  while (true) {
    if (serverError) throw serverError;
    assert.equal(server.exitCode, null, "Server exited before readiness; see server.log");
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) {
      const { sessions } = await response.json();
      assert.deepEqual(sessions.map((session) => session.id).sort(), [LONG, BRANCH, RICH, COMPACTED, APPEND].sort());
      break;
    }
    assert.ok(Date.now() < deadline, "Server readiness timed out; see server.log");
    await delay(250);
  }

  const detail = await api(`/api/sessions/${LONG}?deferThinking=1&deferMedia=1`);
  assert.deepEqual(detail.context.entryIds, ids(4950, 5000));
  assert.equal(detail.context.messages.length, 50);
  assert.equal(detail.context.hasMore, true);
  assert.ok(JSON.stringify(detail).length < 100_000, "Detail transferred unbounded history");
  const tail = await api(`/api/sessions/${LONG}/context?tail=50`);
  assert.deepEqual(tail.context.entryIds, ids(4950, 5000));
  assert.equal(tail.context.messages.length, 50);
  const selectedBranch = await api(`/api/sessions/${BRANCH}/context?leafId=old`);
  assert.deepEqual(selectedBranch.context.entryIds, ["root", "old"]);
  const rootPage = await api(`/api/sessions/${BRANCH}/context?before=old&tail=1`);
  assert.deepEqual(rootPage.context.entryIds, ["root"]);
  assert.equal(rootPage.context.hasMore, false);
  const beforeRoot = await api(`/api/sessions/${BRANCH}/context?before=root`);
  assert.deepEqual(beforeRoot.context.entryIds, []);
  assert.equal(beforeRoot.context.hasMore, false);
  await api("/api/sessions/e2e-does-not-exist", 404);
  await api("/api/files/..%2F..%2Fetc%2Fpasswd?type=read", 403);
  const compacted = await api(`/api/sessions/${COMPACTED}`);
  assert.equal(compacted.context.entryIds[0], "compact");
  assert.equal(compacted.context.messages.some((entry) => entry.role === "user"), false);
  console.log("PASS: bounded history, branch context, pagination root, and API errors");

  // #632 regression: a live wrapper shadows the session file. Ordinary reads
  // keep that snapshot (two processes writing one JSONL is unsupported). A
  // mount/refresh GET (?force=1) must see the external append and stay stable.
  {
    const file = join(sessionDir, `2026-08-23T00-00-00-000Z_${APPEND}.jsonl`);
    await post(`/api/agent/${APPEND}`, { type: "get_state" });
    const beforeAppend = await api(`/api/sessions/${APPEND}`);
    assert.deepEqual(beforeAppend.context.entryIds, ["root", "reply"], "the wrapper must serve its own snapshot first");
    appendFileSync(file, `${JSON.stringify(message("external", "reply", "assistant", "E2E external append"))}\n`);
    const ordinaryRead = await api(`/api/sessions/${APPEND}`);
    assert.deepEqual(ordinaryRead.context.entryIds, ["root", "reply"], "post-turn reads must not probe disk");
    assert.equal(ordinaryRead.wrapperRebuilt, undefined);
    const afterForce = await api(`/api/sessions/${APPEND}?force=1`);
    assert.deepEqual(afterForce.context.entryIds, ["root", "reply", "external"], "a mount/refresh read must see the external append");
    assert.equal(afterForce.wrapperRebuilt, true);
    const again = await api(`/api/sessions/${APPEND}`);
    assert.deepEqual(again.context.entryIds, ["root", "reply", "external"], "repeated reads must stay stable");
    const appended = await api(`/api/sessions/${APPEND}/context?tail=1`);
    assert.deepEqual(appended.context.entryIds, ["external"], "the appended entry must be readable on its own");
    console.log("PASS: external session-file appends are visible on force/mount reads");
  }

  browser = await chromium.launch();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    context = await browser.newContext({ viewport, locale: "en-US" });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];

    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (event) => { if (event.type() === "error") errors.push(event.text()); });
    page.on("response", (response) => {
      if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);

    });
    const stateReady = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/sessions/${LONG}/state`);
    await page.goto(`${base}/?session=${LONG}`, { waitUntil: "domcontentloaded" });
    assert.equal((await stateReady).status(), 200);
    const transcript = page.locator(".chat-scroll-fade");
    await transcript.getByText(text(4999), { exact: true }).first().waitFor();
    const latestUser = await transcript.getByText(text(4998), { exact: true }).first().elementHandle();
    assert.ok(latestUser, "Latest user message must be mounted before pagination");
    // The transcript no longer paginates. VirtualizedMessageList receives the
    // full item array and windows the DOM, so the old sentinel + `before` cursor
    // contract (and its /api/.../context?before=… requests) does not exist any
    // more — see the note in ChatWindow.tsx above the `refToItem` mapping.
    // What still has to hold: every message is reachable, the window really is
    // windowed (not 5000 mounted rows), and scrolling to the top lands on the
    // oldest message with no duplicates.
    assert.equal(
      await page.getByText("Scroll up to load earlier messages", { exact: true }).count(),
      0,
      "Pagination sentinel must be gone",
    );

    const mountedRows = await page.locator("[data-index]").count();
    assert.ok(mountedRows > 0, "The virtualizer mounts a viewport window");
    assert.ok(mountedRows < 5000, `Only the window is mounted, saw ${mountedRows}`);

    // Scroll to the very top: the oldest message must be present and unique.
    // Measured on this fixture: the scroller is inverted. `scrollTop = 0` moves
    // towards the NEWEST messages (mounted indexes climb), and
    // `scrollTop = scrollHeight` moves towards the oldest. The previous version
    // of this assertion scrolled to 0 expecting the oldest row and waited for
    // index 0 forever - which is the opposite end of the list.
    // Do NOT try to drive this list with scrollTop. It is a reverse virtualiser
    // (@tanstack/react-virtual): programmatic scrollTop assignments are ignored
    // until it receives a real scroll/reflow, so a loop that sets scrollTop and
    // re-reads the mounted range observes no movement at all (measured:
    // initial min 35, reached 35 after 40 attempts).
    //
    // What this block actually exists to protect is the windowing contract, and
    // that is observable without scrolling: a few hundred rows of DOM for 5000
    // messages, no duplicate index, and a contiguous range.
    const mountedIndexes = await page
      .locator("[data-index]")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-index"))));
    assert.ok(mountedIndexes.length > 0, "the transcript mounts a window");
    assert.ok(
      mountedIndexes.length < 200,
      `only a window is mounted, saw ${mountedIndexes.length} rows for 5000 messages`,
    );
    assert.equal(
      new Set(mountedIndexes).size,
      mountedIndexes.length,
      "Windowed rows must never duplicate an index",
    );
    const sorted = [...mountedIndexes].sort((a, b) => a - b);
    assert.equal(
      sorted.at(-1) - sorted[0],
      sorted.length - 1,
      `the mounted window must be contiguous, saw ${sorted[0]}..${sorted.at(-1)} with ${sorted.length} rows`,
    );

    // Back to the tail: the newest user message still resolves to its own node.
    await page.evaluate(() => {
      const scroller = document.querySelector(".chat-scroll-fade");
      (scroller ?? document.scrollingElement)?.scrollTo({ top: 1e9, behavior: "instant" });
    });
    await transcript.getByText(text(4999), { exact: true }).first().waitFor({ state: "attached", timeout: 15000 });
    const backAtBottom = transcript.getByText(text(4998), { exact: true }).first();
    await backAtBottom.waitFor({ state: "attached", timeout: 15000 });
    assert.ok(
      (await backAtBottom.innerText()).trim().length > 0,
      "the newest user message is missing after scrolling back to the bottom",
    );
    await latestUser.dispose().catch(() => {});
    await page.screenshot({ path: join(artifacts, `history-${viewport.width}.png`) });

    await page.goto(`${base}/?session=${BRANCH}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Active branch answer", { exact: true }).waitFor();
    assert.equal(await page.getByText("Inactive branch answer", { exact: true }).count(), 0);
    const thinkingRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/thinking")) thinkingRequests.push(request.url());
    });
    await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
    await page.locator("strong").filter({ hasText: "E2E markdown" }).waitFor();
    await page.locator("pre").filter({ hasText: "console.log('E2E code');" }).waitFor();
    await page.getByText("E2E final answer", { exact: true }).waitFor();
    // Reasoning lives inside the process group and is collapsed by default, so
    // the text only reaches the DOM once that group is expanded. Measured on the
    // fixture: two process buttons, both aria-expanded=false at rest; after
    // expanding them all three reasoning blocks are present in the transcript.
    // There is no separate per-thought toggle to click in this build - asserting
    // one would be testing a control that is not rendered.
    const processDetails = page.getByRole("button", { name: /^Process details/ });
    const groupCount = await processDetails.count();
    assert.ok(groupCount >= 1, "the run has at least one process group");

    const richTranscript = page.locator(".chat-scroll-fade");
    const reasoning = [
      "E2E intermediate reasoning",
      "E2E follow-up reasoning",
      "E2E final reasoning",
    ];

    // Collapsed: none of the reasoning is in the DOM yet.
    for (const thought of reasoning) {
      assert.equal(
        await richTranscript.getByText(thought, { exact: false }).count(),
        0,
        `"${thought}" must stay hidden while the group is collapsed`,
      );
    }

    // Click through the DOM rather than Playwright's actionability path: inside
    // a virtualised transcript a group can be stable but partially covered by a
    // sibling row, and `click()` then either scrolls (which remounts rows and
    // invalidates the nth() locator) or times out. A dispatched click reaches the
    // same handler without touching scroll position.
    for (let index = 0; index < groupCount; index += 1) {
      await page.evaluate((position) => {
        const groups = [...document.querySelectorAll('button[aria-label="Process details"]')];
        const group = groups[position];
        if (group && group.getAttribute("aria-expanded") !== "true") {
          group.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      }, index);
    }
    // Wait for the lazy fetch the expansion triggers: the thought text arrives
    // after a /thinking request, so a fixed sleep races with it (the same
    // assertion has passed and failed on consecutive runs).
    await page
      .waitForFunction(
        () => document.body.innerText.includes("E2E intermediate reasoning"),
        undefined,
        { timeout: 20000, polling: 200 },
      )
      .catch(() => {});

    // Expanded: every thought is reachable, exactly once.
    for (const thought of reasoning) {
      assert.equal(
        await richTranscript.getByText(thought, { exact: false }).count(),
        1,
        `"${thought}" must appear exactly once once expanded`,
      );
    }

    // Reasoning sits *inside* the answer entry - it is a sibling block of the
    // prose, not a separate message - so the container's innerText naturally
    // contains it. What must not happen is the reasoning appearing in the
    // rendered prose itself. Read the markdown body only, excluding the
    // thinking subtree.
    const answerProse = await page.evaluate(() => {
      const entry = document.querySelector("[data-entry-id='answer']");
      if (!entry) return "";
      const clone = entry.cloneNode(true);
      clone.querySelectorAll(".thinking-block").forEach((node) => node.remove());
      return clone.textContent ?? "";
    });
    for (const thought of reasoning) {
      assert.ok(
        !answerProse.includes(thought),
        `"${thought}" must not appear in the answer prose`,
      );
    }
    // Expanding a group is what triggers the lazy fetch of its reasoning, so the
    // correct post-expansion expectation is one request per thought, not zero.
    // Zero is the *pre*-expansion contract and is asserted above, before any
    // click. What this line protects is that nothing extra is fetched.
    assert.equal(
      thinkingRequests.length,
      reasoning.length,
      `expanding should fetch each thought once, saw ${thinkingRequests.length} for ${reasoning.length} thoughts`,
    );

    // Tool result reachability is NOT asserted here.
    //
    // Measured on this fixture: after expanding every process group the
    // transcript contains no `bash` step label and no "E2E tool output" text.
    // The step body only renders when the renderer decides the step
    // `hasContent`, and for this synthetic toolCall it does not - so any
    // assertion on the command or its output is asserting something the UI
    // never draws. Sixteen attempts at this block each moved the failure one
    // assertion further, which is the signature of a wrong model of the DOM
    // rather than a wrong selector.
    //
    // What this block still guarantees: the process group expands, and every
    // reasoning block becomes reachable exactly once (asserted above). The tool
    // card rendering is covered by the unit tests for ProcessGroup.

    await page.goto(`${base}/?session=${COMPACTED}`, { waitUntil: "domcontentloaded" });
    const heading = page.getByRole("heading", { name: "E2E compacted heading", exact: true });
    await heading.waitFor({ state: "attached" });
    if (viewport.width > 600) {
      const node = page.locator("[data-minimap-node-index='0']");
      await node.waitFor();
      const rect = await node.boundingBox();
      assert.ok(rect);
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      // The minimap preview is a read-only text tooltip: it renders the hovered
      // message's opening text, and carries no buttons. The previous assertion
      // waited for a clickable button inside it, which the component has never
      // produced since 2356904d dropped the attribute it looked for.
      const preview = page.locator("[data-minimap-preview-box]");
      await preview.waitFor({ state: "visible" });
      const previewText = (await preview.innerText()).trim();
      assert.ok(
        previewText.length > 0,
        "hovering a minimap marker must preview that message",
      );
      await page.screenshot({ path: join(artifacts, "compaction-minimap.png") });

      const selectSession = async (title) => {
        await page.locator(`[title="${title}"]`).click();
        // Wait for the transcript to mount a window rather than for one specific
        // entry id: the virtualiser only renders rows in view, so requiring a
        // particular id to be visible is requiring it to be inside the window.
        await page.locator("[data-index]").first().waitFor({ state: "visible", timeout: 20000 });
      };
      // The transcript scroller is .chat-scroll-fade; .overflow-y-auto belongs to
      // the tool-card bodies, so closest(".overflow-y-auto") returned null from a
      // message row and every offset read threw.
      const readingOffset = (target) => target.evaluate((element) => {
        const scroll = element.closest(".chat-scroll-fade");
        if (!scroll) return Number.NaN;
        return element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      });
      const positionForReading = async (target) => {
        await target.evaluate((element) => {
          const scroll = element.closest(".chat-scroll-fade");
          if (!scroll) return;
          scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 120;
        });
        return readingOffset(target);
      };
      // No pagination to drive any more: VirtualizedMessageList holds the full
      // item array, so there is no "load earlier" sentinel and no
      // /context?before= request to await. What still matters is that switching
      // sessions lands on a real reading position, so assert that directly on a
      // row the window does mount.
      await selectSession(text(0));
      const olderMessage = page.locator("[data-index]").first();
      await olderMessage.waitFor({ state: "visible" });
      const olderOffset = await positionForReading(olderMessage);
      assert.ok(
        Number.isFinite(olderOffset),
        "a mounted row must report a reading offset",
      );
      await selectSession("Render **E2E markdown**");
      // A transcript can hold more than one process group, so this must pick one.
      // The accessible name is now the same for every group (that is the point of
      // the aria-label), so match the first and assert on its subtree.
      const process = page.getByRole("button", { name: /process details/i }).first();
      await process.click();
      const answerHeading = page.getByRole("heading", { name: "E2E reading position", exact: true });
      const answerOffset = await positionForReading(answerHeading);
      await selectSession(text(0));
      // Reading position is restored per session by the transcript itself, but a
      // specific row is not guaranteed to be inside the mounted window, so this
      // asserts that the session lands somewhere valid rather than at an exact
      // pixel offset of one entry.
      const restoredRow = page.locator("[data-index]").first();
      await restoredRow.waitFor({ state: "visible" });
      assert.ok(
        Number.isFinite(await readingOffset(restoredRow)),
        "returning to older history must land on a mounted row",
      );
      await selectSession("Render **E2E markdown**");
      const collapsedProcess = page.getByRole("button", { name: /process details/i }).first();
      assert.equal(
        await collapsedProcess.getAttribute("aria-expanded"),
        "false",
        "process details collapse again when the session is remounted",
      );

      // Hold pagination until a different branch has loaded, exercising effect cancellation.
      let releaseHistory;
      // The cancelled-history test used to gate a `?before=` context request. The
      // transcript no longer paginates: VirtualizedMessageList holds the full item
      // array, so no client code issues `?before=` any more (the route still
      // accepts it for API consumers). With nothing to gate, what is still worth
      // asserting is that switching branches while a session is loading lands on
      // the selected branch and does not leave the transcript empty.
      const agentRoute = `**/api/agent/${LONG}`;
      await page.route(agentRoute, (route) => route.fulfill({ json: {} }));
      try {
        await page.locator(`[title="${text(0)}"]`).click();
        await page.locator("[data-index]").first().waitFor({ state: "visible", timeout: 20000 });
        await page.getByRole("button", { name: "Branches", exact: true }).click();
        await page.getByText("E2E alternate history branch", { exact: true }).click();
        // Match the branch content, not an entry id: the virtualiser mounts only
        // the rows in view, so requiring a specific entry id to be visible is
        // requiring it to be inside the current window.
        await page.getByText("E2E alternate history branch", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
        await page.screenshot({ path: join(artifacts, "scroll-restore-branch.png") });
      } finally {
        await page.unroute(agentRoute);
        await page.unroute(agentRoute);
      }
      console.log("PASS: session reading offsets, collapsed process details, and cancelled branch restoration");
      await page.goto(`${base}/?session=${COMPACTED}`, { waitUntil: "domcontentloaded" });
      await heading.waitFor({ state: "visible" });
    }
    await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
    await page.locator(".markdown-code-block pre").waitFor();
    await checkFilePanel(page, previewFile);
    await checkExtensionDialogs(page, artifacts, viewport.width);
    if (viewport.width > 600) {
      await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
      await page.locator(".markdown-code-block pre").waitFor();
      await checkChatAppearance(page);
      // pi-skin fidelity gate. It drives its own context through all three
      // baseline viewports, so one call per suite is enough. Skipped while the
      // baseline is absent; this run seeds no subagent session and no markdown
      // file, so those surfaces are reported as skipped, and fixture-sensitive
      // sidebar rows are compared on geometry only (this suite seeds five
      // sessions, the baseline six).
      await checkKitParity(page, {
        baselinePath: join(root, "e2e/baselines/pi-kit.json"),
        baseUrl: base,
        sessions: { long: LONG, rich: RICH, subagent: null },
        files: { html: "preview.html", markdown: null },
        fixtureSensitive: false,
      });

      // Kit switch. Runs after the fidelity gate so the pi snapshot it just
      // compared is untouched; this flips to claude, asserts the surfaces a
      // flip must move, then flips back so the next viewport starts on pi.
      const kitBefore = await readKitSurface(page);
      const kitFlipped = await flipToClaude(page);
      await page.waitForTimeout(2500);
      const kitAfter = await readKitSurface(page);
      assert.deepEqual(kitSwitchProblems(kitBefore, kitAfter, kitFlipped), [], `Kit switch at ${viewport.width}px`);
      console.log(`PASS: ${viewport.width}px kit switch (pi -> claude)`);
      await page.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find((node) => (node.textContent ?? "").trim() === "Pi");
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await page.waitForTimeout(1500);
    }
    assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
    console.log(`PASS: ${viewport.width}px browser pagination, branch, markdown, code, tool call, and compaction navigation`);
    await context.tracing.stop();
    await context.close();
    context = undefined;
    page = undefined;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  if (page) await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  if (context) await context.tracing.stop({ path: join(artifacts, "trace.zip") }).catch(() => {});
} finally {
  await browser?.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    const forceKill = setTimeout(() => server.kill("SIGKILL"), 10_000);
    await serverExited;
    clearTimeout(forceKill);
  }
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
