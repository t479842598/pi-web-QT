import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the real TypeScript module, replacing only its imports. In particular,
// no runtime/provider/resource-loader factory or user settings path can escape
// this allow-list. SessionManager and queue/goal persistence use temporary files.
function loadTs(filename, dependencies) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  });
  const loaded = { exports: {} };
  const require = (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency in ${filename}: ${name}`);
    return dependencies[name];
  };
  new Function("require", "module", "exports", outputText)(require, loaded, loaded.exports);
  return loaded.exports;
}

export function createRpcHarness(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "pi-web-rpc-regression-"));
  fs.mkdirSync(path.join(root, "agents"));
  fs.writeFileSync(path.join(root, "agents", "settings.json"), '{"builtInEnabled":false}');
  t.after(async () => {
    // node:test after hooks run in registration order. Close wrappers before
    // removing their sidecars, including wrappers that were never registered.
    for (const wrapper of harness.wrappers) await wrapper.shutdown().catch(() => {});
    for (const wrapper of globalThis.__piSessions.values()) await wrapper.shutdown().catch(() => {});
    for (const cleanup of harness.cleanups) cleanup();
    await nextTurn();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const lib = fileURLToPath(new URL("./", import.meta.url));
  const queue = loadTs(path.join(lib, "queue-store.ts"), { fs, crypto });
  const goal = loadTs(path.join(lib, "goal-engine.ts"), { fs });
  const calls = { services: [], create: [], disposed: [], cleanup: 0, preferences: 0, archive: [], cached: [] };
  const paths = new Map();
  const sessions = [];
  const inners = [];
  const harness = { root, queue, goal, calls, paths, sessions, inners, wrappers: [], cleanups: [] };
  const settingsManager = {
    getEnabledModels: () => [], getDefaultProvider: () => undefined,
    getDefaultModel: () => undefined, getDefaultTools: () => [],
  };
  const services = { settingsManager, modelRuntime: {}, resourceLoader: {} };
  harness.services = services;
  harness.makeSession = (id = crypto.randomUUID(), options = {}) => {
    const file = path.join(root, `${id}.jsonl`);
    const header = { type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: root, ...options };
    fs.writeFileSync(file, JSON.stringify(header) + "\n");
    paths.set(id, file);
    sessions.push({ id, path: file, cwd: root, ...options });
    return file;
  };
  harness.makeInner = (manager) => {
    const listeners = new Set();
    const steering = [], followUp = [];
    const inner = {
      sessionId: manager?.getSessionId() ?? crypto.randomUUID(),
      sessionFile: manager?.getSessionFile(),
      sessionManager: manager ?? { getEntries: () => [], getCwd: () => root },
      settingsManager,
      resourceLoader: { getAgentsFiles: () => ({ agentsFiles: [] }) },
      isStreaming: false, isBashRunning: false, isCompacting: false,
      agent: { state: {}, streamFunction: () => { throw new Error("Real model calls are forbidden"); } },
      extensionRunner: { setUIContext() {}, async emit() {} },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      emit(event) { for (const listener of listeners) listener(event); },
      getContextUsage: () => null,
      getSteeringMessages: () => [...steering], getFollowUpMessages: () => [...followUp],
      get pendingMessageCount() { return steering.length + followUp.length; },
      clearQueue() {
        const previous = { steering: steering.splice(0), followUp: followUp.splice(0) };
        inner.emit({ type: "queue_update", steering: [], followUp: [] });
        return previous;
      },
      async steer(text) { steering.push(text); inner.emit({ type: "queue_update", steering: [...steering], followUp: [...followUp] }); },
      async followUp(text) { followUp.push(text); inner.emit({ type: "queue_update", steering: [...steering], followUp: [...followUp] }); },
      async prompt() { throw new Error("Tests must explicitly supply fake prompt behavior"); },
      async abort() {}, abortBash() {},
      getLastAssistantText: () => "working", supportsThinking: () => false,
      dispose() { calls.disposed.push(inner); },
    };
    inners.push(inner);
    return inner;
  };
  const reader = {
    resolveSessionPath: async (id) => paths.get(id),
    resolveSessionIdByPath: async (file) => [...paths].find(([, value]) => value === file)?.[0],
    cacheSessionPath: (id, file) => { paths.set(id, file); calls.cached.push(id); },
    invalidateSessionPathCache: (id) => paths.delete(id),
    invalidateSessionListCache() {}, invalidateOpenSessionCache() {},
    invalidateSessionManagerCache() {},
    openSessionManager: (file) => SessionManager.open(file, root),
    openSessionCached: (file) => SessionManager.open(file, root),
    getSessionEntries: (file) => SessionManager.open(file, root).getEntries(),
    buildSessionContext: () => ({ messages: [], entryIds: [], oldestEntryId: null, hasMore: false, thinkingLevel: "off", model: null }),
    listSessionSummaries: async () => [...sessions],
    getSessionListVersion: () => 0,
    attachSessionProjectInfo: async (list) => list,
    listAllSessions: async () => [...sessions],
    mergeSessionLists: (left, right) => [...left, ...right],
    readSessionHeader: (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0]) : undefined,
    getAgentDir: () => root,
    getLatestModelChange: () => null,
  };
  const subagents = {
    listSubagentProfiles: () => [], readSubagentSessionResources: () => null,
    readSubagentRun: (_entries, id) => sessions.find((session) => session.id === id)?.relation ?? null,
    SUBAGENT_META_TYPE: "pi-web:subagent",
  };
  const dependencies = {
    fs, path, crypto,
    "@earendil-works/pi-coding-agent": {
      SessionManager: {
        open: (file, dir) => SessionManager.open(file, dir ?? root),
        create: (cwd, dir) => SessionManager.create(cwd, dir ?? root),
        listAll: async () => [],
      },
      Theme: class {}, initTheme() {}, getAgentDir: () => root,
      SettingsManager: { create: () => settingsManager },
      createAgentSessionServices: async (options) => {
        calls.services.push(options);
        return harness.createServices ? harness.createServices(options) : services;
      },
      createAgentSessionFromServices: async (options) => {
        calls.create.push(options);
        return harness.createSession ? harness.createSession(options) : { session: harness.makeInner(options.sessionManager) };
      },
    },
    "@earendil-works/pi-tui": { KeybindingsManager: class {}, TUI_KEYBINDINGS: {} },
    "./image-attachments": { validateAgentImages: () => null },
    "./queue-store": queue,
    "./goal-engine": goal,
    "./models-cache": { invalidateModelsCache() {} },
    "./model-scope": { resolveVisibleModels: async () => ({ visible: [], scopedModels: [] }), selectInitialModelScope: () => null },
    "./project-trust": { projectTrustReloadOptions: () => ({}), getProjectTrustStatus: () => ({ trusted: false }) },
    "./session-reader": reader,
    "./subagent-extension": { createSubagentExtension: () => ({}), preferPiWebSubagentExtension: (value) => value },
    "./subagents": subagents,
    "./session-tool-selection": {},
    "./session-liveness": { hasActiveSessionLivenessProvider: () => false },
    "./subagent-runtime": { createSubagentController: () => ({ extensionRuntime: {}, async abort() {} }) },
    "./subagent-settings": { isBuiltInSubagentsEnabled: () => false, getSubagentSettingsPath: () => path.join(root, "agents", "settings.json") },
    "./powershell-settings": {}, "./extension-tools": {}, "./project-command-env": {},
    "./startup-preferences": { persistExplicitStartupPreferences: async () => {
      calls.preferences += 1;
      return harness.persistPreferences ? harness.persistPreferences() : { modelDefaultChanged: false };
    } },
    "./modes-config": { readModeSettings: () => ({ permissionRules: {}, toolApprovalMode: "auto" }) },
    "./permission": { policyFromStrings: () => ({}), decide: () => "allow" },
    "./modes": { READ_ONLY_TOOL_NAMES: new Set() },
    "./custom-ui-terminal": {}, "./error-log": {},
    "./chat-only": { CHAT_ONLY_RESOURCE_LOADER_OPTIONS: {}, contextFilesSystemPrompt: () => "" },
    "./exact-system-prompt": { createExactSystemPromptExtension: () => ({}) },
    "./async-bash": { AsyncProcessManager: class { cleanup() { calls.cleanup += 1; } }, createAsyncBashTools: () => [] },
  };
  globalThis.__piSessions = new Map();
  globalThis.__piStartLocks = new Map();
  globalThis.__piStartingSessionCwds = new Map();
  globalThis.__piSessionLifecycles = new Map();
  const rpc = loadTs(path.join(lib, "rpc-manager.ts"), dependencies);
  harness.rpc = rpc;
  harness.makeWrapper = (inner) => {
    const wrapper = new rpc.AgentSessionWrapper(inner);
    harness.wrappers.push(wrapper);
    return wrapper;
  };
  harness.loadRoute = () => loadTs(path.join(lib, "../app/api/sessions/[id]/route.ts"), {
    fs, path, crypto, "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@earendil-works/pi-coding-agent": dependencies["@earendil-works/pi-coding-agent"],
    "@/lib/json-response": { jsonResponse: (_req, body) => Response.json(body) },
    "@/lib/session-reader": reader, "@/lib/rpc-manager": rpc,
    "@/lib/settings-lock": { mutateSettingsJson: async (fn) => fn({}) },
    "@/lib/session-archive": { dropSessionArchiveEntry: async (_dir, id) => { calls.archive.push(id); } },
    "@/lib/queue-store": queue, "@/lib/goal-engine": goal,
    "@/lib/session-details": {}, "@/lib/session-stats": {}, "@/lib/modes": {}, "@/lib/project-tree-response": {},
    "@/lib/project-tree": { projectTreeForResponse: () => ({ nodes: [] }), toSummaryTree: (t) => t },
    "@/lib/session-path": { sessionPathKey: (file) => path.resolve(file) },
    "@/lib/subagents": subagents, "@/lib/session-tool-selection": {},
    "@/lib/perf": { startServerPerf: () => undefined },
    "@/lib/session-revision": { computeSessionRevision: () => null },
    "@/lib/types": {},
  });
  return harness;
}
