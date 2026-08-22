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

test("routes blocking extension requests through deduplicated browser attention notifications", () => {
  const completionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleAgentEnd = useCallback"),
    appShellSource.indexOf("  const handleAttentionNeeded = useCallback"),
  );
  const extensionRequestSource = source.slice(
    source.indexOf("  const handleExtensionUiRequest = useCallback"),
    source.indexOf("  const settleUiStage = useCallback"),
  );
  const attentionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleAttentionNeeded = useCallback"),
    appShellSource.indexOf("  const handleAutoName = useCallback"),
  );

  assert.match(
    extensionRequestSource,
    /isBlockingExtensionUiRequest\(request\)[\s\S]*?onAttentionNeeded\?\.\(request\)/,
  );
  assert.match(chatWindowSource, /onAttentionNeeded, onSessionCreated/);
  assert.match(completionSource, /if \(!shouldShowBrowserNotification\(\)\) return/);
  assert.doesNotMatch(completionSource, /document\.visibilityState === "visible"/);
  assert.match(attentionSource, /shouldShowBrowserNotification\(\)/);
  assert.match(attentionSource, /claimExtensionAttentionNotification\(request, notifiedAttentionRequestIdsRef\.current\)/);
  assert.match(attentionSource, /tag: `pi-extension-ui:\$\{request\.id\}`/);
  assert.match(appShellSource, /onAttentionNeeded=\{handleAttentionNeeded\}/);
});

test("keeps live following cancellable when the user scrolls away from the tail", () => {
  const streamUpdateSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  const scrollHandlerSource = source.slice(
    source.indexOf("const handleScrollPositionChange"),
    source.indexOf("// Load session on mount"),
  );
  const scrollToBottomSource = source.slice(
    source.indexOf("const scrollToBottom"),
    source.indexOf("const currentModel"),
  );

  assert.match(source, /const liveFollowFrameRef = useRef<number \| null>\(null\)/);
  assert.match(source, /const previousScrollTopRef = useRef\(0\)/);
  assert.match(source, /const wasAttached = isNearBottomRef\.current;[\s\S]*?const isAttached = getLiveFollowAttached\([\s\S]*?wasAttached,[\s\S]*?previousScrollTopRef\.current,[\s\S]*?scrollTop,[\s\S]*?clientHeight,[\s\S]*?scrollHeight/);
  assert.match(scrollHandlerSource, /const isAgentRunning = agentRunningRef\.current;[\s\S]*?isAgentRunning\s*\? CHAT_SCROLL_REATTACH_TOLERANCE\s*:\s*CHAT_SCROLL_TAIL_TOLERANCE/);
  assert.match(source, /previousScrollTopRef\.current = scrollTop/);
  assert.match(scrollToBottomSource, /messagesEndRef\.current\?\.scrollIntoView\(\{ behavior \}\);\s*if \(container\) previousScrollTopRef\.current = container\.scrollTop/);
  assert.match(streamUpdateSource, /liveFollowFrameRef\.current === null/);
  assert.match(streamUpdateSource, /requestAnimationFrame\(\(\) => \{[\s\S]*?liveFollowFrameRef\.current = null;[\s\S]*?if \(isNearBottomRef\.current\) scrollToBottom\("auto"\)/);
  assert.match(scrollHandlerSource, /!wasAttached && isAttached && isAgentRunning[\s\S]*?scrollToBottom\("auto"\)/);
  assert.match(scrollHandlerSource, /cancelAnimationFrame\(liveFollowFrameRef\.current\)/);
  assert.match(source, /previousScrollTopRef\.current = container\.scrollTop;\s*container\.addEventListener\("scroll", handleScrollPositionChange/);
  assert.doesNotMatch(source, /SCROLL_BOTTOM_THRESHOLD|completionScrollAllowedRef|ignoreProgrammaticScrollUntilRef/);
});

test("keeps a newly sent user message at the top while its response starts", () => {
  const streamUpdateSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  const userScrollSource = source.slice(
    source.indexOf("const scrollUserMsgToTop"),
    source.indexOf("const handleScrollPositionChange"),
  );
  const scrollEffectSource = source.slice(
    source.indexOf("useLayoutEffect(() => {\n    if (messages.length > 0)"),
    source.indexOf("// Load model list"),
  );

  assert.match(streamUpdateSource, /!pendingScrollToUserRef\.current && isNearBottomRef\.current/);
  assert.match(source, /const \[promptAnchorActive, setPromptAnchorActive\] = useState\(false\)/);
  assert.match(source, /pendingScrollToUserRef\.current = true;\s*setPromptAnchorActive\(true\)/);
  assert.match(userScrollSource, /const targetTop = Math\.min\(Math\.max\(0, elAbsTop - 16\), maxScrollTop\)/);
  assert.match(userScrollSource, /cancelAnimationFrame\(liveFollowFrameRef\.current\)/);
  assert.match(userScrollSource, /isNearBottomRef\.current = true/);
  assert.match(userScrollSource, /previousScrollTopRef\.current = targetTop/);
  assert.match(userScrollSource, /container\.scrollTo\(\{ top: targetTop, behavior: "auto" \}\)/);
  assert.match(scrollEffectSource, /pendingScrollToUserRef\.current = false;[\s\S]*?scrollUserMsgToTop\(\)/);
  assert.match(chatWindowSource, /const contentEnd = spacer\.getBoundingClientRect\(\)\.top[\s\S]*?getPromptAnchorSpacerHeight\([\s\S]*?targetTop,[\s\S]*?contentEnd,[\s\S]*?container\.clientHeight/);
  assert.match(chatWindowSource, /<div ref=\{promptAnchorSpacerRef\} aria-hidden="true" \/>/);
  assert.match(chatWindowSource, /const promptAnchorAdjustmentDoneRef = useRef\(false\)/);
  assert.match(chatWindowSource, /promptAnchorAdjustmentDoneRef\.current = false/);
  assert.match(chatWindowSource, /const isInitialMeasurement = !promptAnchorAdjustmentDoneRef\.current;[\s\S]*?promptAnchorAdjustmentDoneRef\.current = true;[\s\S]*?if \(needsInitialAdjustment\) scrollUserMsgToTop\(\)/);
});

test("keeps prompt anchor measurement outside the React update cycle", () => {
  const anchorEffectStart = chatWindowSource.indexOf(
    "useLayoutEffect(() => {\n    const spacer = promptAnchorSpacerRef.current;",
  );
  assert.notEqual(anchorEffectStart, -1);
  const syncEffectStart = chatWindowSource.indexOf(
    "useLayoutEffect(() => {\n    promptAnchorUpdateRef.current?.();",
    anchorEffectStart,
  );
  assert.notEqual(syncEffectStart, -1);
  const anchorLifecycleEffectSource = chatWindowSource.slice(
    anchorEffectStart,
    syncEffectStart,
  );
  const anchorSyncEffectSource = chatWindowSource.slice(
    syncEffectStart,
    chatWindowSource.indexOf("const availableThinkingLevels"),
  );

  assert.doesNotMatch(anchorLifecycleEffectSource, /\bset[A-Z][A-Za-z0-9]*\s*\(/);
  assert.doesNotMatch(anchorSyncEffectSource, /\bset[A-Z][A-Za-z0-9]*\s*\(/);
  assert.doesNotMatch(chatWindowSource, /setPromptAnchorSpacer|useState[^\n]*promptAnchorSpacer/);
  assert.doesNotMatch(anchorLifecycleEffectSource, /streamState\.streamingMessage/);
  assert.match(anchorLifecycleEffectSource, /spacer\.style\.height = nextPromptAnchorSpacerHeight > 0/);
  assert.match(anchorLifecycleEffectSource, /promptAnchorUpdateRef\.current = updatePromptAnchorSpacer/);
  assert.match(anchorLifecycleEffectSource, /new ResizeObserver\(schedulePromptAnchorMeasure\)/);
  assert.match(anchorLifecycleEffectSource, /observer\?\.observe\(messageContent\)/);
  assert.match(anchorLifecycleEffectSource, /if \(disposed \|\| promptAnchorMeasureFrameRef\.current !== null\) return/);
  assert.match(anchorLifecycleEffectSource, /promptAnchorMeasureFrameRef\.current = requestAnimationFrame\(\(\) => \{\s*promptAnchorMeasureFrameRef\.current = null;\s*updatePromptAnchorSpacer\(\)/);
  assert.match(anchorLifecycleEffectSource, /disposed = true;[\s\S]*?promptAnchorUpdateRef\.current === updatePromptAnchorSpacer[\s\S]*?cancelAnimationFrame\(promptAnchorMeasureFrameRef\.current\)/);
  assert.match(anchorSyncEffectSource, /promptAnchorUpdateRef\.current\?\.\(\);\s*\}, \[streamState\.streamingMessage\]\)/);
  assert.match(chatWindowSource, /<div ref=\{messageContentRef\} style=\{\{/);
});

test("uses the prompt anchor as the only trailing message spacer", () => {
  assert.match(chatWindowSource, /<div ref=\{promptAnchorSpacerRef\} aria-hidden="true" \/>[\s\S]*?<div ref=\{messagesEndRef\} \/>/);
  assert.doesNotMatch(chatWindowSource, /bottomComposer(?:Ref|Height|ScrollFrameRef)/);
  assert.doesNotMatch(chatWindowSource, /new ResizeObserver\(updateBottomComposerHeight\)/);
});

test("keeps a detached viewport in place when streaming completes", () => {
  const scrollEffectSource = source.slice(
    source.indexOf("useLayoutEffect(() => {\n    if (messages.length > 0)"),
    source.indexOf("// Load model list"),
  );

  assert.match(scrollEffectSource, /!agentRunningRef\.current && isNearBottomRef\.current[\s\S]*?scrollToBottom\("auto"\)/);
  assert.doesNotMatch(scrollEffectSource, /\|\|/);
  assert.match(source, /addEventListener\("scroll", handleScrollPositionChange/);
});
