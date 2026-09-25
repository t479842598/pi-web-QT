import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

test("get_tools preserves the SDK tool definition fields", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const getToolsSource = source.slice(
    source.indexOf('case "get_tools"'),
    source.indexOf('case "get_commands"'),
  );

  assert.match(getToolsSource, /\.getAllTools\(\)/);
  assert.match(getToolsSource, /\.\.\.t,/);
  assert.match(getToolsSource, /active: active\.has\(t\.name\)/);
});

test("RPC validates image arrays before sending prompt, steer, or follow-up commands", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const sendSource = source.slice(
    source.indexOf("  async send(command:"),
    source.indexOf("    switch (type) {", source.indexOf("  async send(command:")),
  );

  assert.match(sendSource, /type === "prompt" \|\| type === "steer" \|\| type === "follow_up"/);
  assert.match(sendSource, /validateAgentImages\(command\.images\)/);
});

test("queue item edits serialize rebuilds and reconcile from pi's live queue", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /private queueMutationTail: Promise<void> = Promise\.resolve\(\)/);
  assert.match(source, /private async withQueueMutation<T>\(operation: \(\) => Promise<T>\)/);
  assert.match(source, /private async mutateLiveQueue<T>\(kind: QueueKind/);
  assert.match(source, /this\.reconcileQueue\(queues\.steering, queues\.followUp\)/);
  assert.match(source, /await this\.mutateLiveQueue\(kind/);
});

test("queue import, staging, and requeue validate attached images", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /type === "requeue_at"/);
  assert.match(source, /private validateQueueEntries\(entries: QueueEntryInput\[\]\)/);
  assert.match(source, /this\.validateQueueEntries\(entries\);/);
  assert.match(source, /const imageError = validateAgentImages\(entry\.images\)/);
});

test("custom extension UI receives the headless terminal facade", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
  assert.match(customUiSource, /emitCustomUiRender/);
});

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("RPC startup opens an existing session once and uses its canonical cwd", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const resolveIndex = startupSource.indexOf("resolveVisibleModels(");
  const createIndex = startupSource.indexOf("createAgentSessionFromServices(");

  assert.ok(resolveIndex >= 0);
  assert.ok(createIndex > resolveIndex);
  assert.match(startupSource, /selectInitialModelScope\(/);
  assert.match(startupSource, /scopedModels: \[\.\.\.scope\.scopedModels\]/);
  assert.match(startupSource, /model: startupModel/);
  assert.match(startupSource, /thinkingLevel: initial\.thinkingLevel/);
});

test("RPC session startup treats only sessions with messages as continuing", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(
    startupSource,
    /const hasExistingMessages = branch\.some\(\(entry\) => entry\.type === "message" && \(entry\.message as \{ role\?: string \}\)\.role !== "system"\)/,
  );
  assert.match(startupSource, /const initial = hasExistingMessages/);
  assert.match(startupSource, /getLatestModelChange\(branch as unknown as SessionEntry\[\]\)/);
  assert.match(startupSource, /model: startupModel/);
  assert.doesNotMatch(startupSource, /const initial = sessionFile/);
  assert.doesNotMatch(startupSource, /sessionManager\.buildSessionContext\(\)/);
});

test("RPC session startup opens an existing session file only once and trusts its cwd", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const commandRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const eventsRoute = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");

  assert.equal((startupSource.match(/SessionManager\.open\(/g) ?? []).length, 1);
  assert.match(startupSource, /const sessionCwd = sessionManager\.getCwd\(\)/);
  assert.match(startupSource, /projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(startupSource, /cwd: sessionCwd/);
  assert.match(startupSource, /const hasExistingMessages = branch\.some\(\(entry\) => entry\.type === "message" && \(entry\.message as \{ role\?: string \}\)\.role !== "system"\)/);
  assert.match(startupSource, /const initial = hasExistingMessages \? null : selectInitialModelScope\(/);
  assert.match(startupSource, /getLatestModelChange\(branch as unknown as SessionEntry\[\]\)/);
  assert.match(startupSource, /model: startupModel/);
  assert.doesNotMatch(commandRoute, /SessionManager\.open\(/);
  assert.doesNotMatch(eventsRoute, /SessionManager\.open\(/);
});

test("normal session teardown paths use graceful extension shutdown", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const deleteRouteSource = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const trustRouteSource = await readFile(new URL("../app/api/project-trust/route.ts", import.meta.url), "utf8");

  assert.match(source, /void this\.shutdown\(\)\.catch/);
  assert.match(source, /await this\.shutdown\(\)/);
  assert.match(deleteRouteSource, /await getRpcSession\(id\)\?\.shutdown\(\)/);
  assert.match(trustRouteSource, /await destroyRpcSessionsForCwd\(result\.cwd\)/);
});

test("normal sessions restore persisted tool selections before loading resources", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const registrationSource = source;

  assert.match(startupSource, /const selectedToolNames = subagentResources\?\.tools \?\? toolNames \?\? \[\]/);
  assert.match(source, /appendSessionToolSelection\(manager, toolNames\)/);
  assert.ok(startupSource.indexOf("const chatOnly") < startupSource.indexOf("createAgentSessionServices("));
  assert.match(startupSource, /chatOnly\s*\? \{ \.\.\.CHAT_ONLY_RESOURCE_LOADER_OPTIONS/);
  assert.match(startupSource, /const trustReloadOptions = subagentResources[\s\S]*?subagentLoadsResources[\s\S]*?projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(registrationSource, /wrapper\.beginExtensionBinding\(\{ forceEmptySystemPrompt: toolNames\?\.length === 0 \}\)/);
});

test("crossing the Chat-only boundary persists and rebuilds the wrapper", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const switchSource = source.slice(
    source.indexOf("export async function setRpcSessionTools"),
    source.indexOf("export function getRunningRpcSessionIds"),
  );

  assert.match(switchSource, /!hasCurrentResourcePolicy\s*\|\| existing\.isChatOnly\(\) !== \(toolNames\.length === 0\)/);
  assert.match(switchSource, /appendSessionToolSelection\(existing\.inner\.sessionManager, toolNames\)/);
  assert.match(switchSource, /await existing\.shutdown\(\)/);
  assert.match(switchSource, /__recreate__\$\{randomUUID\(\)\}/);
  assert.match(switchSource, /sessionId: started\.realSessionId/);
});

test("clone copies the requested leaf into a child session", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const cloneSource = source.slice(
    source.indexOf('case "clone"'),
    source.indexOf('case "navigate_tree"'),
  );

  assert.match(cloneSource, /typeof command\.leafId === "string"/);
  assert.match(cloneSource, /branchHasAssistant/);
  assert.match(cloneSource, /createBranchedSession\(leafId\)/);
  assert.match(cloneSource, /cacheSessionPath\(newSessionId, clonedPath\)/);
  assert.match(cloneSource, /invalidateSessionListCache\(\)/);
  assert.match(cloneSource, /return \{ cancelled: false, newSessionId \}/);
});

test("fork_branch copies the selected assistant entry without replacing the source session", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-quoted-branch-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "source prompt", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "selected response" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const selectedEntryId = manager.getLeafId();
  const sourceFile = manager.getSessionFile();
  let forkedFile;
  let disposed = false;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: {},
    agent: { state: {} },
    dispose() { disposed = true; },
  });

  try {
    const result = await wrapper.send({ type: "fork_branch", entryId: selectedEntryId });
    const sessions = await SessionManager.list(root, sessionDir);
    const forkedInfo = sessions.find((session) => session.id === result.newSessionId);
    assert.ok(forkedInfo);
    forkedFile = forkedInfo.path;
    assert.equal(SessionManager.open(forkedFile, sessionDir).getLeafId(), selectedEntryId);
    assert.equal(manager.getLeafId(), selectedEntryId);
    assert.equal(disposed, false);
  } finally {
    wrapper.destroy();
    if (forkedFile) await unlink(forkedFile);
    if (sourceFile) await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("fork before the first message persists a reopenable message-free child session", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-root-fork-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  const settingsEntryId = manager.appendModelChange("test", "test-model");
  const firstEntryId = manager.appendMessage({ role: "user", content: "source prompt", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "source response" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const sourceFile = manager.getSessionFile();
  let forkedFile;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: { emit: async () => {} },
    agent: { state: {} },
    dispose() {},
  });

  try {
    const result = await wrapper.send({ type: "fork", entryId: firstEntryId });
    const sessions = await SessionManager.list(root, sessionDir);
    const forkedInfo = sessions.find((session) => session.id === result.newSessionId);
    assert.ok(forkedInfo);
    forkedFile = forkedInfo.path;

    const forked = SessionManager.open(forkedFile, sessionDir);
    assert.equal(forked.getHeader().parentSession, sourceFile);
    assert.equal(forked.getLeafId(), settingsEntryId);
    assert.deepEqual(forked.getEntries(), [manager.getEntry(settingsEntryId)]);
  } finally {
    wrapper.destroy();
    if (forkedFile) await unlink(forkedFile);
    if (sourceFile) await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("session replacement rejects active work and clone writes one reopenable child", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-clone-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "clone fixture", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "fixture response" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const cloneLeafId = manager.getLeafId();
  manager.appendSessionInfo("source-only metadata");

  const sourceFile = manager.getSessionFile();
  let clonedFile;
  let releaseModelRefresh;
  let signalModelRefresh;
  const modelRefreshStarted = new Promise((resolve) => { signalModelRefresh = resolve; });
  const modelRefreshHeld = new Promise((resolve) => { releaseModelRefresh = resolve; });
  let releaseShutdown;
  let signalShutdown;
  const shutdownStarted = new Promise((resolve) => { signalShutdown = resolve; });
  const shutdownHeld = new Promise((resolve) => { releaseShutdown = resolve; });
  let finishPrompt;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    prompt: (_message, options) => new Promise((resolve) => {
      finishPrompt = resolve;
      options.preflightResult?.(true);
    }),
    modelRuntime: {
      getModel: () => undefined,
      refresh: async () => {
        signalModelRefresh();
        await modelRefreshHeld;
      },
    },
    extensionRunner: {
      emit: async () => {
        signalShutdown();
        await shutdownHeld;
        throw new Error("fixture shutdown failure");
      },
    },
    agent: { state: {} },
    dispose() {},
  });

  try {
    const modelChange = wrapper.send({ type: "set_model", provider: "test", modelId: "missing" });
    await modelRefreshStarted;
    await assert.rejects(
      wrapper.send({ type: "clone" }),
      /Cannot clone while another session command is running/,
    );
    releaseModelRefresh();
    await assert.rejects(modelChange, /Model not found/);

    await wrapper.send({ type: "prompt", message: "keep this run active" });
    await assert.rejects(
      wrapper.send({ type: "fork", entryId: manager.getLeafId() }),
      /Cannot fork while the session is running/,
    );
    assert.ok(finishPrompt);
    finishPrompt();
    await new Promise((resolve) => setImmediate(resolve));

    const firstClone = wrapper.send({ type: "clone", leafId: cloneLeafId });
    await shutdownStarted;
    await assert.rejects(
      wrapper.send({ type: "clone" }),
      /Session is being copied to a new session/,
    );
    let shutdownErrorLog = "";
    const originalConsoleError = console.error;
    console.error = (...args) => { shutdownErrorLog = args.join(" "); };
    let result;
    try {
      releaseShutdown();
      result = await firstClone;
    } finally {
      console.error = originalConsoleError;
    }
    assert.match(shutdownErrorLog, /clone succeeded, but source session shutdown failed/);

    const sessions = await SessionManager.list(root, sessionDir);
    const clonedInfo = sessions.find((session) => session.id === result.newSessionId);
    assert.ok(clonedInfo);
    clonedFile = clonedInfo.path;

    const cloned = SessionManager.open(clonedFile, sessionDir);
    assert.equal(cloned.getHeader().parentSession, sourceFile);
    assert.equal(cloned.getLeafId(), cloneLeafId);
    assert.deepEqual(cloned.buildSessionContext().messages, manager.buildSessionContext().messages);
  } finally {
    wrapper.destroy();
    if (clonedFile) await unlink(clonedFile);
    if (sourceFile) await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("cancelled session replacement releases its lock", async () => {
  const manager = SessionManager.inMemory(tmpdir());
  let autoRetryEnabled = false;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    setAutoRetryEnabled: (enabled) => { autoRetryEnabled = enabled; },
    extensionRunner: {},
    agent: { state: {} },
    dispose() {},
  });

  try {
    assert.deepEqual(await wrapper.send({ type: "fork", entryId: "missing" }), { cancelled: true });
    await wrapper.send({ type: "set_auto_retry", enabled: true });
    assert.equal(autoRetryEnabled, true);
  } finally {
    wrapper.destroy();
  }
});

test("clone cancels an assistant-free branch without creating a file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-clone-empty-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "no assistant yet", timestamp: Date.now() });
  const sourceFile = manager.getSessionFile();
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: { emit: async () => {} },
    agent: { state: {} },
    dispose() {},
  });

  try {
    assert.deepEqual(await wrapper.send({ type: "clone" }), { cancelled: true });
    assert.equal((await SessionManager.list(root, sessionDir)).length, 0);
  } finally {
    wrapper.destroy();
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("new-session route applies model scope during construction instead of follow-up commands", async () => {
  const source = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  assert.match(source, /initialModel: \{ provider, modelId \}/);
  assert.match(source, /thinkingLevel: explicitThinkingLevel/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_model"/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_thinking_level"/);
  assert.match(source, /model: state\.model/);
  assert.match(source, /thinkingLevel: state\.thinkingLevel/);
});

test("prompt routes mark only preflight failures as rejected", async () => {
  const existingRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  for (const source of [existingRoute, newRoute]) {
    assert.match(source, /let promptAccepted = false/);
    assert.match(source, /await .*\.send\(/);
    assert.match(source, /promptAccepted = .*\.type === "prompt"/);
    assert.match(source, /commandType === "prompt" && !promptAccepted/);
  }
});

test("exact prompts are sent through before_agent_start instead of the SDK prompt state", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const subagentSource = await readFile(new URL("./subagent-runtime.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const promptSource = source.slice(
    source.indexOf('case "prompt"'),
    source.indexOf('case "abort"'),
  );

  // Pi 0.86 replays agent.state.systemPrompt from the transcript: assigning it throws,
  // and the loop's request context no longer carries a systemPrompt field.
  // Merged fork+upstream design: the exact prompt is applied both through the
  // before_agent_start extension AND mirrored onto agent.state (applyExactSystemPrompt).
  assert.match(source, /private applyExactSystemPrompt\(\): void/);
  assert.match(source, /installExactSystemPromptContinuation\(\)/);
  assert.match(startupSource, /const exactSystemPromptExtension = createExactSystemPromptExtension\(\(\) => exactSystemPromptRef\.current\?\.\(\)\)/);
  assert.match(startupSource, /exactSystemPromptRef\.current = /);
  assert.match(startupSource, /\{ \.\.\.CHAT_ONLY_RESOURCE_LOADER_OPTIONS, extensionFactories: \[exactSystemPromptExtension\] \}/);
  assert.match(startupSource, /usesExactSystemPrompt \? \{ extensionFactories: \[exactSystemPromptExtension\] \} : \{\}/);  // kept
  assert.match(subagentSource, /extensionFactories: \[createExactSystemPromptExtension\(\(\) => promptPlan\.exactSystemPrompt\)\]/);
  assert.match(promptSource, /preflightResult: \(success: boolean\) => \{[\s\S]*?acceptPreflight\(\);/);
  assert.doesNotMatch(promptSource, /requestedToolNames/);
});

test("running-state broadcasts dedupe identical snapshots to avoid SSE flooding", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const notifySource = source.slice(
    source.indexOf("let lastRunningSnapshot = \"\""),
    source.indexOf("export function getRunningRpcSessionIds"),
  );
  assert.match(notifySource, /let lastRunningSnapshot = ""/);
  assert.match(notifySource, /const serialized = JSON\.stringify\(snapshots\)/);
  assert.match(notifySource, /if \(serialized === lastRunningSnapshot\) return/);
  assert.match(notifySource, /lastRunningSnapshot = ""/);
});

test("session bus exposes subscribe/unsubscribe and whitelist forwarding", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /export type SessionBusEvent =/);
  assert.match(source, /export function subscribeSessionBus/);
  assert.match(source, /export function getSessionBusListenersCount/);
  assert.match(source, /const SESSION_BUS_EVENT_TYPES = new Set\(/);
  // The wrapper's inner.subscribe callback forwards whitelisted events to the bus.
  const startSource = source.slice(
    source.indexOf("    this.unsubscribe = this.inner.subscribe("),
    source.indexOf("  loadQueueRecovery(): void"),
  );
  assert.match(startSource, /SESSION_BUS_EVENT_TYPES\.has\(event\.type\)/);
  assert.match(startSource, /broadcastSessionBusEvent\(event\.type, this\.sessionId, event\)/);
});

test("session bus is zero-cost without subscribers and coalesces message_update", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const busSource = source.slice(
    source.indexOf("// ─── Cross-client session event bus ───"),
    source.indexOf("/**\n * Get or create an AgentSession"),
  );

  // Zero cost: both publish helpers bail out before iterating when nobody listens.
  assert.match(busSource, /if \(!listeners \|\| listeners\.size === 0\) return/);
  // Whitelist gate sits before any delivery.
  assert.match(busSource, /if \(type !== "message_update"\)/);
  assert.match(busSource, /publishSessionBus\(\{ type, sessionId, payload \}\)/);
  // Streaming updates are coalesced per sessionId in a timer window.
  assert.match(busSource, /const busCoalesceState = new Map</);
  assert.match(busSource, /SESSION_BUS_COALESCE_MS/);
  assert.match(busSource, /clearTimeout\(existing\.timer\)/);
});

test("steer and follow_up clear the running phase on completion", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const steerSource = source.slice(
    source.indexOf('case "steer":'),
    source.indexOf('case "follow_up":'),
  );
  const followUpSource = source.slice(
    source.indexOf('case "follow_up":'),
    source.indexOf('case "get_tools":'),
  );
  // Phase set before the turn, cleared in finally so the spinner does not linger.
  assert.match(steerSource, /this\.promptPhase = "waiting_model"/);
  assert.match(steerSource, /this\.promptPhase = null/);
  assert.match(steerSource, /finally \{/);
  assert.match(followUpSource, /this\.promptPhase = "waiting_model"/);
  assert.match(followUpSource, /this\.promptPhase = null/);
  assert.match(followUpSource, /finally \{/);
});

test("session bus whitelist includes agent_start and message_start", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const whitelist = source.slice(
    source.indexOf("const SESSION_BUS_EVENT_TYPES = new Set(["),
    source.indexOf("]);", source.indexOf("const SESSION_BUS_EVENT_TYPES = new Set([")),
  );
  // Without agent_start, a remote client only consuming the bus never sets
  // agentRunningRef and silently drops every message_update/message_end.
  assert.match(whitelist, /"agent_start"/);
  assert.match(whitelist, /"message_start"/);
  assert.match(whitelist, /"message_update"/);
  assert.match(whitelist, /"message_end"/);
});

test("goal commands, server-side continuation, and sidecar persistence are wired", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  // Goal engine lives on the wrapper and is rehydrated from the sidecar.
  assert.match(source, /private readonly goalEngine = new GoalEngine\(\)/);
  assert.match(source, /loadGoalState\(inner\.sessionFile\)/);
  assert.match(source, /goalEngine\.hydrate\(restored\)/);
  assert.match(source, /saveGoalState\(this\.sessionFile, this\.goalEngine\.getState\(\)\)/);

  // Commands are dispatched through the existing RPC switch.
  assert.match(source, /case "goal_start"/);
  assert.match(source, /case "goal_pause"/);
  assert.match(source, /case "goal_resume"/);
  assert.match(source, /case "goal_stop"/);
  assert.match(source, /case "goal_edit"/);
  assert.match(source, /case "get_goal_state"/);

  // Agent settlement drives the continuation server-side.
  assert.match(source, /handleGoalSettled\(\)/);
  assert.match(source, /goalContinuationInFlight/);
  // The continuation must run as a real prompt, not a queued follow_up: the SDK
  // only drains its follow-up queue inside an active run, so on an idle session
  // a queued continuation would never start (the original "goal stalls after
  // one turn" bug).
  assert.match(source, /this\.inner\.prompt\(buildGoalContinuationPrompt\(goalText\),/);
  assert.doesNotMatch(source, /this\.inner\.followUp\(buildGoalContinuationPrompt\(/);
  // Driving is deferred until the wrapper is genuinely idle, because
  // agent_settled fires inside the SDK run's finally, before promptRunning
  // clears.
  assert.match(source, /goalContinuationPending/);
  assert.match(source, /maybeDriveGoalContinuation\(\)/);
  assert.match(source, /tryDriveGoalContinuation\(\)/);
  // Pausing/stopping must not clear the user's own queue.
  assert.match(source, /cancelGoalContinuation\(\)/);

  // Authoritative state is broadcast to clients.
  assert.match(source, /goal_state_changed/);

  // get_state exposes the goal state for reload-time recovery.
  assert.match(source, /goalState: this\.goalEngine\.getState\(\)/);
});

test("async bash tools are injected via customTools and cleaned up on destroy", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAsyncBashTools\(asyncBashManager\)/);
  assert.match(startupSource, /new AsyncProcessManager\(\)/);
  assert.match(startupSource, /customTools: asyncBashTools/);
  assert.match(startupSource, /cleanupAsyncBash\(\)/);
  assert.match(source, /from "\.\/async-bash"/);
});
