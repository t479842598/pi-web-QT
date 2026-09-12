import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("keeps the session event stream open through the idle grace window", () => {
  const graceSource = source.slice(
    source.indexOf("const scheduleEventStreamClose"),
    source.indexOf("const finishPromptWithoutStream"),
  );
  const finishSource = source.slice(
    source.indexOf("const finishPromptWithoutStream"),
    source.indexOf("const waitForPromptSettlement"),
  );
  const agentStartSource = source.slice(
    source.indexOf('case "agent_start"'),
    source.indexOf('case "agent_end"'),
  );
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );
  const agentSettledSource = source.slice(
    source.indexOf('case "agent_settled"'),
    source.indexOf('case "prompt_done"'),
  );

  assert.match(source, /const EVENT_STREAM_IDLE_GRACE_MS = 120_000/);
  assert.match(graceSource, /setTimeout\(\(\) => void checkServerIdle\(\), EVENT_STREAM_IDLE_GRACE_MS\)/);
  assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/);
  assert.match(graceSource, /closeEvents\(\)/);
  assert.match(finishSource, /scheduleEventStreamClose\(sid\)/);
  assert.doesNotMatch(finishSource, /closeEvents\(\)/);
  assert.doesNotMatch(agentEndSource, /closeEvents\(\)/);
  assert.match(agentStartSource, /cancelEventStreamGrace\(\)/);
  assert.match(agentSettledSource, /scheduleEventStreamClose\(sid\)/);
});

test("deduplicates same-session event stream connection attempts", () => {
  const ensureSource = source.slice(
    source.indexOf("const ensureEventsConnected"),
    source.indexOf("const respondToExtensionUi"),
  );

  assert.match(ensureSource, /eventSourceSessionIdRef\.current === sid/);
  assert.match(ensureSource, /current\.readyState === EventSource\.OPEN/);
  assert.match(ensureSource, /attempt\?\.source === current && attempt\.pending/);
  assert.match(source, /const EVENT_STREAM_CONNECT_TIMEOUT_MS = 30_000/);
});

test("preserves desktop terminal provider error notices during agent_end", () => {
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );

  assert.match(agentEndSource, /event\.willRetry !== true/);
  assert.match(agentEndSource, /event\.messages as AgentMessage\[\]/);
  assert.match(agentEndSource, /message\.stopReason === "error" && message\.errorMessage/);
  assert.match(agentEndSource, /addNotice\(\{ type: "error", message: message\.errorMessage \}\)/);
});

test("prompt completion uses one settlement state machine", () => {
  const promptDoneSource = source.slice(
    source.indexOf('case "prompt_done"'),
    source.indexOf('case "prompt_error"'),
  );
  const sendSource = source.slice(
    source.indexOf("const handleSend = useCallback"),
    source.indexOf("const executeBash = useCallback"),
  );

  assert.match(promptDoneSource, /notifyPromptStage\(runId\)/);
  assert.match(promptDoneSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(sendSource, /rpcPromptPendingRef\.current = true/);
  assert.match(sendSource, /if \(promptRequestStarted && sentSessionId\)/);
  assert.match(sendSource, /void waitForPromptSettlement\(sentSessionId, promptRunId\)/);
});

test("coalesces streaming message snapshots and drops stale queued updates", () => {
  const agentStartSource = source.slice(
    source.indexOf('case "agent_start"'),
    source.indexOf('case "agent_end"'),
  );
  const updatesSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "tool_execution_start"'),
  );
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );

  assert.match(source, /createStreamUpdateScheduler\(\(message\) => \{\s*dispatch\(\{ type: "update", message \}\)/s);
  assert.match(updatesSource, /queueStreamUpdate\(normalizeToolCalls\(msg as AgentMessage\)\)/);
  assert.doesNotMatch(updatesSource, /dispatch\(\{ type: "update"/);
  assert.match(agentStartSource, /resetStreamUpdates\(\)/);
  assert.match(agentEndSource, /resetStreamUpdates\(\)/);
  assert.match(updatesSource, /resetStreamUpdates\(\);\s*dispatch\(\{ type: "reset"/s);
});

test("new chats initialize mode defaults from the cached system settings", () => {
  assert.match(source, /readCachedGlobalModeSettings\(\) \?\? defaultModeSettings\(\)/);
  assert.match(source, /cacheGlobalModeSettings\(next\)/);
  assert.match(source, /if \(!sessionId\) cacheGlobalModeSettings/);
});

test("new-chat mode choices stay pending and never overwrite the global defaults", () => {
  const persistSource = source.slice(
    source.indexOf("const persistModeSettings = useCallback"),
    source.indexOf("const handleCollaborationModeChange"),
  );
  // No session id yet (brand-new chat) → hold as pending override, no PUT.
  assert.match(persistSource, /if \(!sessionId\) \{\s*pendingModeOverrideRef\.current = next;/);
  assert.match(persistSource, /\/api\/modes\?session=\$/);
  // Once the session is created, the pending choice lands in modesPerSession.
  const ensureSource = source.slice(
    source.indexOf("const ensureNewSession = useCallback"),
    source.indexOf("const loadSlashCommands"),
  );
  assert.match(ensureSource, /sessionIdRef\.current = result\.sessionId;/);
  assert.match(ensureSource, /pendingModeOverrideRef\.current/);
  assert.match(ensureSource, /\/api\/modes\?session=\$/);
});

test("entering a conversation resets a leftover plan mode to the settings default", () => {
  const loadSource = source.slice(
    source.indexOf("const load = async () => {"),
    source.indexOf("void load();"),
  );
  assert.match(loadSource, /modesEntryHydratedRef\.current && sessionId && next\.collaborationMode === \"plan\"/);
  assert.match(loadSource, /fetch\(\"\/api\/modes\"\)/);
  assert.match(loadSource, /normalizeCollaborationMode\(globalData\.collaborationMode\)/);
});

test("entry never restores plan mode's read-only toolset", () => {
  const loadToolsSource = source.slice(
    source.indexOf("const loadTools = useCallback"),
    source.indexOf("const promoteNewSession"),
  );
  assert.match(loadToolsSource, /preset === \"plan\" && !planModeRef\.current/);
  assert.match(loadToolsSource, /getToolNamesForPreset\(\"default\"\)/);
  assert.match(loadToolsSource, /setToolPresetState\(\"default\"\)/);
});

test("plan mode is derived from the collaboration mode, not a second flag", () => {
  // Regression: an independent planMode state drifted from collaborationMode,
  // so the prompt block, the read-only toolset and the review dialog disagreed
  // about whether plan mode was actually on.
  assert.match(source, /const planMode = collaborationMode === \"plan\";/);
  assert.doesNotMatch(source, /const \[planMode, setPlanMode\] = useState/);
  // The extension is driven on transitions only.
  assert.match(source, /const syncPlanModeExtension = useCallback/);
  assert.match(source, /if \(next === \"plan\" && !wasPlan\) return syncPlanModeExtension\(\"plan\"\);/);
  assert.match(source, /if \(next !== \"plan\" && wasPlan\) return syncPlanModeExtension\(\"normal\"\);/);
  // Mode switching resolves only after the extension was driven, so plan
  // execute/exit cannot race the toolset restore.
  assert.match(source, /const handleCollaborationModeChange = useCallback\(\(mode: CollaborationMode\): Promise<void> =>/);
  // The legacy duplicate prompt block is gone.
  assert.doesNotMatch(source, /PLAN_MODE_INSTRUCTION/);
});

test("plan review feedback runs as a prompt so it is not silently queued", async () => {
  const chatWindow = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  const feedback = chatWindow.slice(
    chatWindow.indexOf("const handlePlanFeedback"),
    chatWindow.indexOf("const handlePlanExit"),
  );
  // A steer on an idle session is only enqueued; the review dialog appears
  // exactly when the run has gone idle, so feedback must start a real run.
  assert.match(feedback, /void handleSend\(text\)/);
  assert.doesNotMatch(feedback, /handleSteer/);
});

test("guards model list writes by request generation and context", () => {
  const loadSource = source.slice(
    source.indexOf("const loadModels = useCallback"),
    source.indexOf("const handleBuiltinSlashCommand"),
  );
  assert.match(loadSource, /modelLoadGenerationRef/);
  assert.match(loadSource, /modelLoadAbortRef/);
  assert.match(loadSource, /requestContextKey/);
  assert.match(loadSource, /generation !== modelLoadGenerationRef\.current/);
  assert.match(loadSource, /requestContextKey !== modelContextKeyRef\.current/);
  assert.match(loadSource, /signal: controller\.signal/);
});

test("consumes global /api/events bus for the current session when direct SSE is closed", () => {
  const busSource = source.slice(
    source.indexOf("// Cross-client message sync."),
    source.indexOf("const handleSend = useCallback"),
  );
  assert.match(busSource, /new EventSource\("\/api\/events"\)/);
  assert.match(busSource, /data\.sessionId !== sessionIdRef\.current/);
  assert.match(busSource, /eventSourceRef\.current\?\.readyState === EventSource\.OPEN/);
  assert.match(busSource, /handleAgentEventRef\.current\?\.\(data\.payload as AgentEvent\)/);
});

test("mode instruction block injects once per mode composition", () => {
  const handleSendSource = source.slice(
    source.indexOf("// Plan mode prefixes every prompt"),
    source.indexOf("const imageBlocks = images?.map"),
  );
  // The block is only prepended when the session-scoped signature has not been
  // injected yet for this conversation and this mode composition.
  assert.match(handleSendSource, /injectedModeSignatureRef\.current\.sessionKey !== sessionKey/);
  assert.match(handleSendSource, /injectedModeSignatureRef\.current\.signature !== modeSignature/);
  assert.match(handleSendSource, /combinedBlock && \(injectedModeSignatureRef\.current\.sessionKey !== sessionKey/);
  assert.match(handleSendSource, /injectedModeSignatureRef\.current = \{ sessionKey, signature: modeSignature \}/);
  assert.match(handleSendSource, /effectiveMessage = message/);
  assert.match(handleSendSource, /const sessionKey = session\?\.id \?\? "new"/);
  // Mode composition changes reset the signature so a fresh block can apply.
  assert.match(source, /injectedModeSignatureRef\.current = \{ sessionKey: "", signature: "" \}/);
});

test("non-empty queue_update schedules a get_state reconcile (self-heal missed drain)", () => {
  const queueCase = source.slice(
    source.indexOf('case "queue_update":'),
    source.indexOf('case "state_sync":'),
  );
  assert.match(queueCase, /scheduleQueueReconcile\(\)/);
  assert.match(queueCase, /clearQueueReconcile\(\)/);
  assert.match(source, /const scheduleQueueReconcile = useCallback/);
  assert.match(source, /queueReconcileTimerRef\.current = setTimeout/);
  // The reconcile reads back get_state and overwrites queuedMessages.
  assert.match(source, /data\.state\?\.queuedMessages !== undefined/);
  assert.match(source, /setQueuedMessages\(normalizeQueuedMessages\(data\.state\.queuedMessages\)\)/);
});

test("reconnects active shell output to its streaming tool call", async () => {
  const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  const updateSource = source.slice(
    source.indexOf('case "tool_execution_update"'),
    source.indexOf('case "queue_update"'),
  );
  const endSource = source.slice(
    source.indexOf('case "tool_execution_end"'),
    source.indexOf('case "tool_execution_update"'),
  );

  assert.match(updateSource, /updateName === "bash" \|\| updateName === "powershell"/);
  assert.match(updateSource, /setActiveToolResults/);
  assert.match(endSource, /setActiveToolResults[\s\S]*next\.delete\(id\)/);
  // The pipeline seeds live partials before the authoritative message results.
  assert.match(chatWindowSource, /buildHistoryPipeline\(messages, entryIds, messageCwd, activeToolResults\)/);
});

test("restoring a running session does not clear an SSE snapshot", () => {
  const reducerSource = source.slice(
    source.indexOf("function streamReducer"),
    source.indexOf("interface AgentEvent"),
  );
  const restoreSource = source.slice(
    source.indexOf("const restoreRunning ="),
    source.indexOf("// 并行运行态探测"),
  );
  assert.match(reducerSource, /case "resume":/);
  // Restoring a session that was already running resumes the stream instead of
  // resetting it, so a partial delivered by the SSE snapshot survives.
  assert.match(restoreSource, /dispatch\(\{ type: "resume" \}\)/);
  assert.doesNotMatch(restoreSource, /dispatch\(\{ type: "start" \}\)/);
});

test("renews the selected-session lease and keeps its stream out of the grace window", () => {
  assert.match(source, /const SESSION_LEASE_RENEW_INTERVAL_MS = 30_000/);
  const leaseSource = source.slice(
    source.indexOf("const renewLease = async ()"),
    source.indexOf("}, [closeEvents, ensureEventsConnected, session?.id]);"),
  );
  assert.match(leaseSource, /\/api\/agent\/\$\{encodeURIComponent\(sid\)\}\/lease/);
  assert.match(leaseSource, /result\.renewed === 0/);
  assert.match(leaseSource, /closeEvents\(\);\s*\n\s*void ensureEventsConnected\(sid\)/);

  // The selected session's stream must not be scheduled for closing: doing so
  // would drop the lease and let idle eviction reap the session.
  const closeSource = source.slice(
    source.indexOf("const scheduleEventStreamClose = useCallback"),
    source.indexOf("const finishPromptWithoutStream"),
  );
  assert.match(closeSource, /if \(sessionPropIdRef\.current === sid\)/);
  assert.match(closeSource, /cancelEventStreamGrace\(\);\s*\n\s*return;/);
});

test("persistModeSettings syncs the ref so one tick can write both axes", () => {
  // The composer's chat-mode picker writes collaborationMode AND toolApprovalMode
  // in the same tick. Each write derives from modeSettingsRef.current, so the
  // ref must be updated synchronously — an effect-synced ref still holds the
  // pre-click value for the second write and silently drops the first axis.
  const persistSource = source.slice(
    source.indexOf("const persistModeSettings = useCallback"),
    source.indexOf("}, []);", source.indexOf("const persistModeSettings = useCallback")),
  );
  assert.match(persistSource, /modeSettingsRef\.current = next;/, "ref is synced inside persistModeSettings");
  const refSyncIndex = persistSource.indexOf("modeSettingsRef.current = next;");
  const setStateIndex = persistSource.indexOf("setModeSettings(next);");
  assert.ok(refSyncIndex >= 0 && setStateIndex >= 0, "both assignments exist");
});
