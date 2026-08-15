import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'models.dart';
import 'pi_api.dart';
import 'localization.dart';

/// One tool call in the current run, tracked live from
/// `tool_execution_start`/`tool_execution_end` events so the UI can show a
/// web-client-style working panel (name, args preview, duration, result)
/// instead of a single text line.
class LiveToolStep {
  LiveToolStep({
    required this.name,
    required this.toolCallId,
    required this.arguments,
    required this.startedAt,
  });

  final String name;
  final String toolCallId;
  final Map<String, dynamic>? arguments;
  final DateTime startedAt;
  DateTime? finishedAt;
  bool isError = false;
  String? resultText;

  bool get running => finishedAt == null;

  Duration? get duration {
    final end = finishedAt;
    if (end == null) return null;
    return end.difference(startedAt);
  }
}

class ChatController extends ChangeNotifier {
  ChatController(this.api) : _language = api.language;

  final PiApi api;
  AppLanguage _language;

  String _tr(String source, [Map<String, Object?> values = const {}]) =>
      AppLocalizations.text(_language, source, values);

  void setLanguage(AppLanguage language) {
    if (_language == language) return;
    _language = language;
    api.setLanguage(language);
    notifyListeners();
  }

  final List<PiSession> sessions = [];

  /// Project display aliases (备注) keyed by directory path.
  final Map<String, String> projectAliases = {};
  bool loadingProjectAliases = false;
  final List<ChatMessage> messages = [];
  final List<PiModel> models = [];
  final List<PiSkill> skills = [];
  final List<PiSlashCommand> slashCommands = [];
  final List<String> skillDiagnostics = [];
  final Set<String> deletingSessionIds = {};

  PiSession? selectedSession;
  PiModel? selectedModel;
  String? activeSessionId;
  String? draftCwd;
  ChatMessage? streamingMessage;
  bool loadingSessions = false;
  bool loadingMessages = false;
  bool loadingModels = false;
  bool loadingSkills = false;
  bool loadingSlashCommands = false;
  bool changingModel = false;
  bool running = false;
  bool compacting = false;
  String? error;
  String? status;

  // ── Goal collaboration mode (mirrors the web client's GoalBanner) ────
  String? goalStatus; // idle | running | paused | blocked | complete
  String? goalText;
  int goalElapsedSeconds = 0;
  String? skillsError;

  // ── Work tasks (MonkeyCode-style task list) ────────────────────────
  final List<PiTask> tasks = [];
  bool loadingTasks = false;
  DateTime? lastTasksRefresh;
  Timer? _tasksTimer;
  bool _tasksTimerRunning = false;

  // ── Session stats (context ring / tokens in the chat info bar) ──────
  int? contextTokens;
  int? maxContextTokens;
  int? totalTokens;
  /// 会话累计消耗 token（来自 get_session_stats 的 tokens 结构）。
  int? tokenInput;
  int? tokenOutput;
  int? tokenTotal;
  /// 流式每秒 token 速率（由输出文本长度估算，约 4 字符/token，对齐网页端）。
  double? tokenRate;
  int _rateLastChars = 0;
  final List<({int at, int chars})> _rateWindow = [];
  static const int _charsPerToken = 4;
  bool loadingStats = false;

  // ── Reconcile watchdog ──────────────────────────────────────────────
  Timer? _reconcileTimer;
  DateTime? _lastEventAt;
  int _reconcileConsecutiveFailures = 0;
  bool _reconciling = false;
  bool _snapshotInFlight = false;

  // ── Streaming UI throttle（message_update 高频事件合并渲染）──────────
  Timer? _streamThrottleTimer;
  bool _streamThrottlePending = false;

  /// 流式更新节流：40ms 窗口内合并多次 notifyListeners，
  /// 避免每条 chunk 都触发全页 rebuild + Markdown 重解析（卡顿主因）。
  void _notifyStreaming() {
    if (_streamThrottleTimer?.isActive ?? false) return;
    _streamThrottleTimer = Timer(const Duration(milliseconds: 40), () {
      _streamThrottleTimer = null;
      if (!_disposed) notifyListeners();
    });
    // 立即通知一次，保证首个 chunk 响应及时
    if (!_streamThrottlePending) {
      _streamThrottlePending = true;
      notifyListeners();
    }
  }

  /// 节流计时器在 dispose 时清理。
  void _disposeStreamThrottle() {
    _streamThrottleTimer?.cancel();
    _streamThrottleTimer = null;
    _streamThrottlePending = false;
  }

  /// Called by the app when it resumes from background (WidgetsBindingObserver
  /// didChangeAppLifecycleState → resumed). Triggers an immediate reconcile
  /// so stale `running` flags are corrected before the user can tap anything.
  void onAppResumed() {
    if (running && activeSessionId != null) {
      _reconcileNow();
    }
  }

  // ── Work tasks ──────────────────────────────────────────────────────

  /// Refreshes the task list. When [projectsOnly] is false and no project
  /// filter is given, lists tasks across all projects.
  Future<void> refreshTasks({String? projectRoot}) async {
    if (loadingTasks) return;
    loadingTasks = true;
    _notify();
    try {
      final result = await api.listTasks(projectRoot: projectRoot);
      tasks
        ..clear()
        ..addAll(result);
      lastTasksRefresh = DateTime.now();
    } catch (_) {
      // Keep the previous list; the UI shows a stale badge rather than an
      // error flash on a flaky mobile connection.
    } finally {
      loadingTasks = false;
      _notify();
    }
  }

  /// Starts a lightweight poller for active tasks while the tasks screen is
  /// visible (every 10s). Call from the screen's lifecycle.
  void startTasksPolling() {
    if (_tasksTimerRunning) return;
    _tasksTimerRunning = true;
    _tasksTimer?.cancel();
    _tasksTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) {
        if (tasks.any((t) => t.status.isActive)) {
          refreshTasks();
        }
      },
    );
  }

  void stopTasksPolling() {
    _tasksTimerRunning = false;
    _tasksTimer?.cancel();
    _tasksTimer = null;
  }

  /// Cancels a running task (left-swipe → amber action).
  Future<void> cancelTask(PiTask task) async {
    await api.taskAction(task.id, task.projectRoot, 'cancel');
    await refreshTasks(projectRoot: task.projectRoot);
  }

  /// Deletes a task (left-swipe → red action, with worktree).
  Future<void> deleteTask(PiTask task, {bool deleteWorktree = true}) async {
    await api.deleteTask(task.id, task.projectRoot, deleteWorktree: deleteWorktree);
    tasks.removeWhere((t) => t.id == task.id);
    _notify();
  }

  /// Creates a task via the `+` FAB sheet.
  Future<void> createTask({
    required String projectRoot,
    required String title,
    String? prompt,
    String? modelId,
  }) async {
    await api.createTask(
      projectRoot: projectRoot,
      title: title,
      prompt: prompt,
      modelId: modelId,
    );
    await refreshTasks(projectRoot: projectRoot);
  }

  /// Fetches aggregated tokens for a task's session (MonkeyCode-style card
  /// metadata). Returns null when the task has no session.
  Future<Map<String, dynamic>?> fetchTaskTokens(PiTask task) async {
    final sessionId = task.conversationId;
    if (sessionId == null || sessionId.isEmpty) return null;
    try {
      return await api.getSessionStats(sessionId);
    } catch (_) {
      return null;
    }
  }

  /// Refreshes the session-stats cache for the active session (context ring
  /// + tokens). Called from message_end / prompt_done / openSession.
  Future<void> refreshSessionStats() async {
    final sessionId = activeSessionId;
    if (sessionId == null || sessionId.isEmpty || loadingStats) return;
    loadingStats = true;
    try {
      final stats = await api.getSessionStats(sessionId);
      final value = _extractStats(stats);
      if (value != null) {
        final (ctx, max, total) = value;
        contextTokens = ctx;
        maxContextTokens = max;
        totalTokens = total;
      }
    } catch (_) {
      // Mobile networks drop; keep the previous values rather than flashing
      // an error.
    } finally {
      loadingStats = false;
      _notify();
    }
  }

  (int? contextTokens, int? maxContextTokens, int? totalTokens)?
  _extractStats(Map<String, dynamic> raw) {
    // get_session_stats returns nested shapes depending on the pi version.
    final direct = raw['stats'];
    final stats = direct is Map ? Map<String, dynamic>.from(direct) : raw;
    final ctx = stats['contextTokens'] ?? stats['contextUsage'];
    final max = stats['maxContextTokens'] ?? stats['contextLimit'];
    final total = stats['totalTokens'] ?? stats['tokens'];
    final ctxNum = ctx is num ? ctx.toInt() : null;
    final maxNum = max is num ? max.toInt() : null;
    final totalNum = total is num ? total.toInt() : null;
    if (ctxNum == null && maxNum == null && totalNum == null) return null;
    // 拆分输入/输出/总计（pi 的 stats.tokens 结构，对齐网页端）
    final tokens = stats['tokens'];
    if (tokens is Map) {
      final inNum = tokens['input'];
      final outNum = tokens['output'];
      final totNum = tokens['total'];
      tokenInput = inNum is num ? inNum.toInt() : null;
      tokenOutput = outNum is num ? outNum.toInt() : null;
      tokenTotal = totNum is num ? totNum.toInt() : null;
    }
    return (ctxNum, maxNum, totalNum);
  }

  void _startReconcileTimer() {
    _reconcileTimer?.cancel();
    _reconcileTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _reconcileNow(),
    );
  }

  void _stopReconcileTimer() {
    _reconcileTimer?.cancel();
    _reconcileTimer = null;
    _reconcileConsecutiveFailures = 0;
  }

  /// Probe the server for the real agent state. If the server says streaming
  /// is false (or the wrapper is gone), the run is over and we can safely
  /// clear the `running` flag.
  Future<void> _reconcileNow() async {
    final id = activeSessionId;
    if (id == null || !running || _reconciling) return;
    _reconciling = true;
    try {
      final state = await api.getAgentState(id);
      if (_disposed || activeSessionId != id || !running) return;
      if (state == null) {
        // Network failure — count consecutive failures but don't kill running
        // yet (user may be on flaky mobile data).
        _reconcileConsecutiveFailures += 1;
        // After 12 consecutive failures (~60s at 5s interval) treat the run
        // as dead: the server wrapper is gone or unreachable.
        if (_reconcileConsecutiveFailures >= 12) {
          running = false;
          status = null;
          streamingMessage = null;
          agentPhase = null;
          liveToolSteps.clear();
          _stopReconcileTimer();
          error ??= _tr('连接中断，运行状态已重置');
          _notify();
          unawaited(_refreshRunSnapshot());
        }
        return;
      }
      _reconcileConsecutiveFailures = 0;
      // GET /api/agent/[id] returns { running, state: <get_state payload> };
      // the streaming flags live under `state`. `running == false` means the
      // server wrapper is gone (idle-reaped) — the run is definitely over.
      final live = state['running'] == true;
      final inner = state['state'] is Map
          ? Map<String, dynamic>.from(state['state'] as Map)
          : const <String, dynamic>{};
      final isStreaming = inner['isStreaming'] == true;
      final isPromptRunning = inner['isPromptRunning'] == true;
      final isCompacting = inner['isCompacting'] == true;
      syncGoalStateFromProbe(inner);
      if (!live || (!isStreaming && !isPromptRunning && !isCompacting)) {
        // Run actually finished (or the wrapper is gone) but we missed the
        // terminal event.
        running = false;
        status = null;
        streamingMessage = null;
        agentPhase = null;
        liveToolSteps.clear();
        _stopReconcileTimer();
        _notify();
        unawaited(_refreshRunSnapshot());
        return;
      }
      // The SSE stream can silently stall (mobile NAT black-holing) while the
      // server keeps the run alive. If we have not heard a single event for a
      // long stretch, fall back to a fresh snapshot refresh so the UI does not
      // show a permanently spinning run. This must NOT call _finishRun (which
      // stops the reconcile timer); use the snapshot-only refresh instead.
      // Reset the marker so a long-running task only refreshes once per
      // minute, not every tick.
      final lastEvent = _lastEventAt;
      if (lastEvent != null &&
          DateTime.now().difference(lastEvent) > const Duration(seconds: 60)) {
        _lastEventAt = DateTime.now();
        unawaited(_refreshRunSnapshot());
      }
    } finally {
      _reconciling = false;
    }
  }

  /// Live tool calls of the current run, in execution order. Cleared when the
  /// run settles. Drives the real-time working panel in the chat.
  final List<LiveToolStep> liveToolSteps = [];

  /// Current agent phase label source: 'waiting_model' | 'running_command' |
  /// 'running_tools' | null (idle). Mirrors the web client's phase indicator.
  String? agentPhase;
  bool projectSkillResourcesLoaded = true;
  String? slashCommandsForSessionId;

  StreamSubscription<Map<String, dynamic>>? _eventSubscription;
  Completer<void>? _connected;
  Timer? _reconnectTimer;
  int _streamGeneration = 0;
  int _reconnectAttempts = 0;
  bool _disposed = false;

  List<String> get knownCwds {
    final values = <String>{};
    for (final session in sessions) {
      if (session.cwd.isNotEmpty) values.add(session.cwd);
    }
    final result = values.toList()..sort();
    return result;
  }

  /// Notifies listeners unless the controller has been disposed. Async methods
  /// that outlive dispose (background loads, reconnects) must use this instead
  /// of a bare [notifyListeners] to avoid a used-after-dispose crash.
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> initialize() async {
    await refreshSessions();
    // Kick off model/skill catalogs in the background once a working directory
    // is known; the UI does not block on them at startup.
    final cwd = draftCwd;
    if (cwd != null) {
      unawaited(
        Future.wait<void>([
          loadModels(cwd),
          loadSkills(cwd),
        ]).then<void>((_) {}, onError: (Object _) {}),
      );
    }
  }

  Future<void> refreshSessions() async {
    loadingSessions = true;
    notifyListeners();
    try {
      final loaded = await api.getSessions();
      loaded.sort((a, b) {
        final byDirectory = a.cwd.toLowerCase().compareTo(b.cwd.toLowerCase());
        return byDirectory != 0
            ? byDirectory
            : b.modified.compareTo(a.modified);
      });
      sessions
        ..clear()
        ..addAll(loaded);
      draftCwd ??= knownCwds.firstOrNull;
      // Refresh project aliases in the background; failures degrade silently.
      unawaited(loadProjectAliases());
    } catch (cause) {
      error = _errorText(cause);
      rethrow;
    } finally {
      loadingSessions = false;
      _notify();
    }
  }

  /// Loads project display aliases (备注) from the server.
  Future<void> loadProjectAliases() async {
    if (loadingProjectAliases) return;
    loadingProjectAliases = true;
    try {
      final aliases = await api.getProjectAliases();
      projectAliases
        ..clear()
        ..addAll(aliases);
      _notify();
    } catch (_) {
      // Alias load failure is non-fatal; degrade to folder names.
    } finally {
      loadingProjectAliases = false;
    }
  }

  /// Sets or clears the display alias (备注) for a directory.
  Future<bool> setProjectAlias(String cwd, String alias) async {
    final ok = await api.setProjectAlias(cwd, alias);
    if (ok) {
      final trimmed = alias.trim();
      if (trimmed.isEmpty) {
        projectAliases.remove(cwd);
      } else {
        projectAliases[cwd] = trimmed;
      }
      _notify();
    }
    return ok;
  }

  /// True when the directory contains at least one running session.
  bool directoryHasRunning(String cwd) =>
      sessions.any((session) => session.cwd == cwd && session.running);

  /// Flips the `running` flag on the session matching [id] (when present in
  /// the local list) so the drawer's running pin / spinner reflect an active
  /// run without waiting for a server refresh.
  void _markSessionRunning(String id, bool value) {
    final index = sessions.indexWhere((session) => session.id == id);
    if (index < 0) return;
    if (sessions[index].running == value) return;
    sessions[index] = sessions[index].copyWith(running: value);
  }

  /// Optimistically sets/clears the server-side pin for a session, then
  /// persists it (PATCH /api/sessions/[id]). The optimistic flip reorders the
  /// grouped session list immediately; a failure rolls back by reloading.
  Future<void> setSessionPinned(String sessionId, bool pinned) async {
    final index = sessions.indexWhere((session) => session.id == sessionId);
    if (index >= 0 && sessions[index].pinned != pinned) {
      sessions[index] = sessions[index].copyWith(pinned: pinned);
      _notify();
    }
    try {
      await api.setSessionPinned(sessionId, pinned);
    } catch (_) {
      // Roll back the optimistic flip and resync from the server.
      try {
        await refreshSessions();
      } catch (_) {
        // Server unreachable — keep the optimistic value; the next refresh
        // reconciles.
      }
    }
  }

  /// 流式 token 速率估算：message_update 携带完整累积文本，统计字符增量
  /// 并用 1s 滑动窗口换算 tok/s（对齐网页端 trackTokenRate）。
  void _trackTokenRate(ChatMessage? message) {
    final text = message?.text ?? '';
    final chars = text.length + (message?.thinking.length ?? 0);
    if (chars == _rateLastChars) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final delta = chars - _rateLastChars;
    _rateLastChars = chars;
    _rateWindow.removeWhere((e) => now - e.at > 1000);
    _rateWindow.add((at: now, chars: delta));
    if (_rateWindow.isEmpty) {
      tokenRate = null;
      return;
    }
    final span = now - _rateWindow.first.at;
    final totalChars = _rateWindow.fold<int>(0, (sum, e) => sum + e.chars);
    tokenRate = span > 0 ? totalChars / _charsPerToken / (span / 1000) : null;
  }

  void _resetTokenRate() {
    _rateLastChars = 0;
    _rateWindow.clear();
    tokenRate = null;
  }

  void _markActiveSessionRunning(bool value) {
    final id = activeSessionId;
    if (id != null) _markSessionRunning(id, value);
  }

  Future<void> loadModels(String cwd, {PiModel? preferred}) async {
    loadingModels = true;
    notifyListeners();
    try {
      final catalog = await api.getModels(cwd);
      models
        ..clear()
        ..addAll(catalog.models);
      selectedModel =
          models.where((model) => model == preferred).firstOrNull ??
          models.where((model) => model == selectedModel).firstOrNull ??
          catalog.defaultModel ??
          models.firstOrNull;
    } catch (cause) {
      error = _errorText(cause);
    } finally {
      loadingModels = false;
      _notify();
    }
  }

  Future<void> loadSkills(String cwd) async {
    loadingSkills = true;
    skillsError = null;
    notifyListeners();
    try {
      final catalog = await api.getSkills(cwd);
      skills
        ..clear()
        ..addAll(catalog.skills);
      skillDiagnostics
        ..clear()
        ..addAll(catalog.diagnostics);
      projectSkillResourcesLoaded = catalog.projectResourcesLoaded;
    } catch (cause) {
      skillsError = _errorText(cause);
    } finally {
      loadingSkills = false;
      _notify();
    }
  }

  Future<void> selectModel(PiModel model) async {
    if (changingModel || model == selectedModel) return;
    changingModel = true;
    notifyListeners();
    try {
      final sessionId = activeSessionId;
      if (sessionId != null) await api.setModel(sessionId, model);
      selectedModel = model;
      error = null;
    } catch (cause) {
      error = _errorText(cause);
    } finally {
      changingModel = false;
      _notify();
    }
  }

  Future<DirectoryListing> browseDirectories([String? path]) =>
      api.browseDirectories(path);

  Future<String> createDirectory(String parentPath, String name) =>
      api.createDirectory(parentPath, name);

  Future<void> openSession(PiSession session) async {
    // 同步部分：立即切换会话状态（不再 await _closeEvents —— 旧 SSE 订阅
    // cancel 可能挂起，导致会话“一直加载中”/输入框禁用）。
    unawaited(_closeEvents());
    _stopReconcileTimer();
    if (activeSessionId != session.id) {
      slashCommands.clear();
      slashCommandsForSessionId = null;
    }
    selectedSession = session;
    activeSessionId = session.id;
    _ensureSessionInFlight = null;
    draftCwd = session.cwd;
    streamingMessage = null;
    running = session.running;
    agentPhase = null;
    liveToolSteps.clear();
    loadingMessages = true;
    error = null;
    status = null;
    messages.clear();
    if (running) {
      _lastEventAt = DateTime.now();
      _startReconcileTimer();
    }
    notifyListeners();
    unawaited(loadCollaborationMode(sessionId: session.id));
    unawaited(loadThinkingLevel());
    unawaited(refreshSessionStats());
    try {
      // Fetch the session, model catalog, and skills in parallel; the latter
      // two only need the cwd and do not depend on the message payload.
      // Session fetch failures are reported but never block the model/skill
      // catalogs from loading.
      final results = await Future.wait<Object?>([
        api
            .getSession(session.id)
            .then<Object?>((value) => value)
            .catchError((Object cause) => _errorText(cause)),
        loadModels(session.cwd),
        loadSkills(session.cwd),
      ]);
      final snapshot = results[0];
      if (snapshot is SessionSnapshot) {
        messages.addAll(snapshot.messages);
        if (snapshot.model != null && snapshot.model!.key.isNotEmpty) {
          final preferred = snapshot.model;
          final match = models.where((m) => m == preferred).firstOrNull;
          if (match != null) selectedModel = match;
        }
      } else if (snapshot is String) {
        error = snapshot;
      }
      if (running) await _connectEvents(session.id);
    } catch (cause) {
      error = _errorText(cause);
    } finally {
      loadingMessages = false;
      _notify();
    }
  }

  Future<void> newChat(String cwd, {PiModel? model}) async {
    unawaited(_closeEvents());
    _stopReconcileTimer();
    selectedSession = null;
    activeSessionId = null;
    _ensureSessionInFlight = null;
    draftCwd = cwd;
    messages.clear();
    streamingMessage = null;
    running = false;
    agentPhase = null;
    liveToolSteps.clear();
    error = null;
    status = null;
    slashCommands.clear();
    slashCommandsForSessionId = null;
    collaborationMode = 'normal';
    await Future.wait([loadModels(cwd, preferred: model), loadSkills(cwd)]);
    _notify();
  }

  /// 一键调用模型生成会话标题（对齐网页端 auto-name），成功后刷新列表。
  Future<void> autoNameSession(String sessionId) async {
    await api.autoNameSession(sessionId);
    await refreshSessions();
  }

  /// 重命名会话（set_session_name 命令），成功后刷新会话列表。
  Future<void> renameSession(String sessionId, String name) async {
    await api.sendAgentCommand(sessionId, {
      'type': 'set_session_name',
      'name': name,
    });
    await refreshSessions();
    selectedSession = sessions
        .where((session) => session.id == sessionId)
        .firstOrNull;
    notifyListeners();
  }

  Future<void> deleteSession(PiSession session) async {
    if (!deletingSessionIds.add(session.id)) return;
    notifyListeners();
    final deletingActiveSession = activeSessionId == session.id;
    try {
      await api.deleteSession(session.id);
      if (deletingActiveSession) await _closeEvents();
      sessions.removeWhere((item) => item.id == session.id);
      if (deletingActiveSession) {
        selectedSession = null;
        activeSessionId = null;
        draftCwd = session.cwd;
        messages.clear();
        streamingMessage = null;
        running = false;
        status = null;
        slashCommands.clear();
        slashCommandsForSessionId = null;
      }
      error = null;
      _notify();
      try {
        await refreshSessions();
      } catch (_) {
        // The server deletion succeeded. Keep the local list updated even if
        // the follow-up refresh temporarily fails.
      }
    } catch (cause) {
      error = _errorText(cause);
      _notify();
      rethrow;
    } finally {
      deletingSessionIds.remove(session.id);
      _notify();
    }
  }

  /// Sends a message. When the agent is already running, the message is
  /// enqueued instead of rejected: [queueMode] 'steer' interrupts the current
  /// run, 'followUp' queues behind it (same as the web client's attach queue).
  Future<void> send(
    String text, {
    List<PiImageAttachment> images = const [],
    String? queueMode,
  }) async {
    final message = text.trim();
    if (message.isEmpty && images.isEmpty) return;
    if (message.length > 200000) {
      error = _tr('消息过长，请分段发送');
      notifyListeners();
      return;
    }
    error = null;
    status = null;
    final imageLabel = images.isEmpty
        ? ''
        : images.length == 1
        ? _tr('[图片]')
        : _tr('[图片 × {count}]', {'count': images.length});
    final queued = running && queueMode != null;
    final textContent = message.isEmpty
        ? imageLabel
        : imageLabel.isEmpty
        ? message
        : '$message\n\n$imageLabel';
    messages.add(ChatMessage(role: 'user', text: textContent, queued: queued));
    if (queued) {
      // Enqueue against the live run; the run itself is untouched.
      try {
        final sessionId = await _ensureSession();
        await api.sendPrompt(
          sessionId,
          message,
          images: images,
          streamingBehavior: queueMode == 'followUp' ? 'followUp' : 'steer',
        );
      } catch (cause) {
        messages.removeLast();
        error = _errorText(cause);
      }
      _notify();
      return;
    }
    running = true;
    _lastEventAt = DateTime.now();
    _startReconcileTimer();
    _markActiveSessionRunning(true);
    notifyListeners();

    try {
      final sessionId = await _ensureSession();
      await _connectEvents(sessionId);
      await api.sendPrompt(sessionId, message, images: images);
    } catch (cause) {
      running = false;
      _stopReconcileTimer();
      error = _errorText(cause);
      _notify();
    }
  }

  Future<List<PiSlashCommand>> loadSlashCommands() async {
    if (loadingSlashCommands) return slashCommands;
    loadingSlashCommands = true;
    notifyListeners();
    try {
      final cwd = draftCwd;
      if (cwd != null && cwd.isNotEmpty) await loadSkills(cwd);
      final sessionId = await _ensureSession();
      if (slashCommandsForSessionId == sessionId) {
        return slashCommands;
      }
      final loaded = await api.getSlashCommands(sessionId);
      slashCommands
        ..clear()
        ..addAll(loaded);
      slashCommandsForSessionId = sessionId;
      return slashCommands;
    } catch (cause) {
      error = _errorText(cause);
      return slashCommands;
    } finally {
      loadingSlashCommands = false;
      _notify();
    }
  }

  Future<BuiltinCommandResult> executeBuiltinCommand(String text) async {
    final match = RegExp(
      r'^/([^\s]+)(?:\s+([\s\S]*))?$',
    ).firstMatch(text.trim());
    if (match == null) return const BuiltinCommandResult(handled: false);
    final command = match.group(1)!.toLowerCase();
    final args = (match.group(2) ?? '').trim();
    if (!const {
      'compact',
      'reload',
      'name',
      'session',
      'copy',
    }.contains(command)) {
      return const BuiltinCommandResult(handled: false);
    }
    if (running) {
      return BuiltinCommandResult(
        handled: true,
        error: _tr('对话正在运行，请稍后再执行内置命令'),
      );
    }
    try {
      final sessionId = await _ensureSession();
      switch (command) {
        case 'compact':
          compacting = true;
          running = true;
          status = _tr('正在压缩对话上下文…');
          notifyListeners();
          try {
            await api.sendAgentCommand(sessionId, {
              'type': 'compact',
              if (args.isNotEmpty) 'customInstructions': args,
            }, timeout: const Duration(minutes: 10));
            final snapshot = await api.getSession(sessionId);
            messages
              ..clear()
              ..addAll(snapshot.messages);
            return BuiltinCommandResult(
              handled: true,
              message: _tr('已压缩对话上下文'),
            );
          } finally {
            compacting = false;
            running = false;
            status = null;
            _stopReconcileTimer();
            notifyListeners();
          }
        case 'reload':
          await api.sendAgentCommand(sessionId, {'type': 'reload'});
          final snapshot = await api.getSession(sessionId);
          messages
            ..clear()
            ..addAll(snapshot.messages);
          slashCommands.clear();
          slashCommandsForSessionId = null;
          final cwd = draftCwd;
          if (cwd != null) {
            await Future.wait([
              loadModels(cwd, preferred: snapshot.model),
              loadSkills(cwd),
            ]);
          }
          await loadSlashCommands();
          notifyListeners();
          return BuiltinCommandResult(handled: true, message: _tr('已重新加载会话资源'));
        case 'name':
          if (args.isEmpty) {
            return BuiltinCommandResult(
              handled: true,
              error: _tr('用法：/name <对话名称>'),
            );
          }
          await api.sendAgentCommand(sessionId, {
            'type': 'set_session_name',
            'name': args,
          });
          await refreshSessions();
          selectedSession = sessions
              .where((session) => session.id == sessionId)
              .firstOrNull;
          notifyListeners();
          return BuiltinCommandResult(
            handled: true,
            message: _tr('对话已重命名为“{name}”', {'name': args}),
          );
        case 'session':
          final stats = await api.sendAgentCommand(sessionId, {
            'type': 'get_session_stats',
          });
          return BuiltinCommandResult(
            handled: true,
            details: const JsonEncoder.withIndent('  ').convert(stats),
          );
        case 'copy':
          final data = await api.sendAgentCommand(sessionId, {
            'type': 'get_last_assistant_text',
          });
          final copyText = data is Map ? data['text']?.toString() ?? '' : '';
          if (copyText.isEmpty) {
            return BuiltinCommandResult(
              handled: true,
              error: _tr('当前没有可复制的助手回复'),
            );
          }
          return BuiltinCommandResult(
            handled: true,
            message: _tr('已复制最后一条助手回复'),
            copyText: copyText,
          );
      }
    } catch (cause) {
      return BuiltinCommandResult(handled: true, error: _errorText(cause));
    }
    return const BuiltinCommandResult(handled: false);
  }

  Future<String>? _ensureSessionInFlight;

  Future<String> _ensureSession() async {
    final existing = activeSessionId;
    if (existing != null) return existing;
    final cwd = draftCwd?.trim();
    if (cwd == null || cwd.isEmpty) {
      throw PiApiException(_tr('请先选择工作目录'));
    }
    // Reuse an in-flight creation so concurrent callers (send + slash-command
    // loading) never create two sessions for the same directory.
    final inFlight = _ensureSessionInFlight;
    if (inFlight != null) return inFlight;
    final future = _createSession(cwd);
    _ensureSessionInFlight = future;
    try {
      return await future;
    } finally {
      if (identical(_ensureSessionInFlight, future)) {
        _ensureSessionInFlight = null;
      }
    }
  }

  Future<String> _createSession(String cwd) async {
    final sessionId = await api.createSession(cwd, model: selectedModel);
    activeSessionId = sessionId;
    _notify();
    return sessionId;
  }

  /// Current collaboration mode (normal / plan / goal). Mirrors the web
  /// client's `/api/modes` per-session setting.
  String collaborationMode = 'normal';

  /// Current thinking level (off / low / medium / high / xhigh / max).
  String thinkingLevel = 'off';

  static const thinkingLevels = [
    'off',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ];

  /// Reads the current thinking level from the server state.
  Future<void> loadThinkingLevel() async {
    final id = activeSessionId;
    if (id == null) return;
    final state = await api.getAgentState(id);
    if (_disposed || state == null) return;
    // Ignore stale responses after a quick session switch.
    if (id != activeSessionId) return;
    final raw = state['state'] is Map
        ? (state['state'] as Map)['thinkingLevel']
        : null;
    if (raw is String && raw.isNotEmpty) {
      thinkingLevel = raw;
      _notify();
    }
  }

  /// Sets the thinking level for the active session.
  Future<void> setThinkingLevel(String level) async {
    if (!thinkingLevels.contains(level)) return;
    final id = activeSessionId;
    if (id == null) return;
    try {
      await api.sendAgentCommand(id, {
        'type': 'set_thinking_level',
        'level': level,
      });
      thinkingLevel = level;
      _notify();
    } catch (cause) {
      error = _errorText(cause);
      _notify();
    }
  }

  Uri _modesUri({String? session}) => Uri.parse(api.profile.baseUrl).replace(
    path:
        '${Uri.parse(api.profile.baseUrl).path == '/' ? '' : Uri.parse(api.profile.baseUrl).path}/api/modes',
    queryParameters: {'session': ?session},
  );

  /// Loads the current collaboration mode for a session (or the global
  /// default when no session is active yet).
  Future<void> loadCollaborationMode({String? sessionId}) async {
    final session = sessionId ?? activeSessionId;
    try {
      // Reuse the api's HTTP client via a raw GET.
      final response = await api.getRaw(_modesUri(session: session));
      if (_disposed || response == null) return;
      // Ignore stale responses after a quick session switch.
      if (session != null && session != activeSessionId) return;
      final raw = response['collaborationMode'];
      if (raw is String && const {'normal', 'plan', 'goal'}.contains(raw)) {
        collaborationMode = raw;
        _notify();
      }
    } catch (_) {
      // Mode load failure is non-fatal; defaults to normal.
    }
  }

  /// Switches the collaboration mode (normal / plan / goal) for the active
  /// session (or global default when no session is active). Returns false on
  /// failure so callers can skip success toasts.
  Future<bool> setCollaborationMode(String mode) async {
    if (!const {'normal', 'plan', 'goal'}.contains(mode)) return false;
    final session = activeSessionId;
    try {
      final uri = _modesUri(session: session);
      final ok = await api.putJson(uri, {'collaborationMode': mode});
      if (!ok) {
        error = _tr('切换协作模式失败');
        _notify();
        return false;
      }
      collaborationMode = mode;
      _notify();
      return true;
    } catch (cause) {
      error = _errorText(cause);
      _notify();
      return false;
    }
  }

  // ── Goal collaboration mode ─────────────────────────────────────────

  /// Starts a goal run with the given text (creates a session first if the
  /// user has not sent anything yet). Mirrors the web client's goal flow.
  Future<bool> startGoal(String goalText) async {
    final text = goalText.trim();
    if (text.isEmpty) return false;
    try {
      final sessionId = await _ensureSession();
      final data = await api.sendAgentCommand(sessionId, {
        'type': 'goal_start',
        'goalText': text,
      });
      final state = data is Map ? data['goalState'] : null;
      if (state is Map) {
        _applyGoalState(Map<String, dynamic>.from(state));
      } else {
        goalStatus = 'running';
        goalText = text;
      }
      collaborationMode = 'goal';
      _notify();
      return true;
    } catch (cause) {
      error = _errorText(cause);
      _notify();
      return false;
    }
  }

  Future<void> pauseGoal() => _sendGoalCommand('goal_pause');
  Future<void> resumeGoal() => _sendGoalCommand('goal_resume');
  Future<void> stopGoal() => _sendGoalCommand('goal_stop');

  Future<void> _sendGoalCommand(String type) async {
    final id = activeSessionId;
    if (id == null) return;
    try {
      final data = await api.sendAgentCommand(id, {'type': type});
      final state = data is Map ? data['goalState'] : null;
      if (state is Map) {
        _applyGoalState(Map<String, dynamic>.from(state));
      }
      _notify();
    } catch (cause) {
      error = _errorText(cause);
      _notify();
    }
  }

  void _applyGoalState(Map<String, dynamic> state) {
    goalStatus = state['status']?.toString();
    goalText = state['goalText']?.toString();
    final elapsed = state['timeUsedSeconds'];
    goalElapsedSeconds = elapsed is num ? elapsed.toInt() : 0;
    if (goalStatus == 'idle' || goalStatus == 'complete') {
      // Goal ended; keep the banner hidden after the run settles.
      goalText = null;
    }
  }

  /// Syncs goal state from a reconcile probe (get_state.goalState).
  void syncGoalStateFromProbe(Map<String, dynamic>? state) {
    if (state == null) return;
    final goal = state['goalState'];
    if (goal is Map) {
      _applyGoalState(Map<String, dynamic>.from(goal));
    }
  }

  /// Builds a compact text reference to a past conversation, suitable for
  /// insertion into the composer. Includes the session title and the last few
  /// message texts (bounded), so the model receives enough context.
  Future<String?> buildSessionReference(PiSession session) async {
    try {
      final snapshot = await api.getSession(session.id);
      final parts = <String>[];
      final title = session.titleFor(_language);
      parts.add('【引用对话：$title】');
      var chars = 0;
      for (final message in snapshot.messages.reversed) {
        final text = message.text.trim();
        if (text.isEmpty) continue;
        final roleLabel = message.role == 'user' ? '用户' : '助手';
        final line = '$roleLabel：$text';
        parts.add(line);
        chars += line.length;
        if (chars >= 1600) break;
      }
      if (parts.length <= 1) {
        return '【引用对话：$title】（对话内容为空）';
      }
      return parts.join('\n\n');
    } catch (_) {
      return null;
    }
  }

  Future<void> stop() async {
    final id = activeSessionId;
    if (id == null) return;
    try {
      if (compacting) {
        await api.sendAgentCommand(id, {'type': 'abort_compaction'});
        compacting = false;
        running = false;
        status = null;
        _stopReconcileTimer();
        _notify();
      } else {
        await api.abort(id);
      }
    } catch (cause) {
      error = _errorText(cause);
      _notify();
    }
  }

  void dismissError() {
    error = null;
    _notify();
  }

  /// Replaces a message in [messages] (identity match) with the deferred
  /// thinking filled in, then notifies listeners so the bubble re-renders.
  void updateMessageThinking(ChatMessage message, String thinking) {
    final index = messages.indexOf(message);
    if (index < 0) return;
    messages[index] = message.copyWith(
      thinking: thinking,
      thinkingEntryId: null,
      thinkingBlockIndex: null,
    );
    _notify();
  }

  Future<void> _closeEvents() async {
    _streamGeneration += 1;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    // Complete any pending handshake so awaiting callers do not hang on a
    // Completer that is about to be discarded.
    final pending = _connected;
    if (pending != null && !pending.isCompleted) pending.complete();
    _connected = null;
    final subscription = _eventSubscription;
    _eventSubscription = null;
    await subscription?.cancel();
  }

  Future<void> _connectEvents(String sessionId) async {
    _reconnectTimer?.cancel();
    final oldSubscription = _eventSubscription;
    _eventSubscription = null;
    await oldSubscription?.cancel();

    final generation = ++_streamGeneration;
    final connected = Completer<void>();
    _connected = connected;
    final stream = await api.events(sessionId);
    if (_disposed || generation != _streamGeneration) {
      // A newer connect/close took over while the HTTP request was in flight.
      // Drain the stream so the underlying socket is released instead of
      // leaking until the server times out.
      stream.drain<void>().catchError((Object _) {});
      return;
    }
    _eventSubscription = stream.listen(
      (event) {
        if (generation == _streamGeneration) _handleEvent(event);
      },
      onError: (Object cause) {
        if (generation != _streamGeneration) return;
        if (!connected.isCompleted) connected.completeError(cause);
        _recoverEventStream(sessionId, generation);
      },
      onDone: () {
        if (generation != _streamGeneration) return;
        if (!connected.isCompleted) {
          connected.completeError(PiApiException(_tr('事件流意外断开')));
        }
        _recoverEventStream(sessionId, generation);
      },
      cancelOnError: false,
    );
    await connected.future.timeout(
      const Duration(seconds: 5),
      onTimeout: () {},
    );
    if (!_disposed && generation == _streamGeneration) {
      _reconnectAttempts = 0;
      status = null;
      _notify();
    }
  }

  void _recoverEventStream(String sessionId, int generation) {
    if (_disposed || generation != _streamGeneration || !running) return;
    // Give up after a bounded number of retries; a server that stays down
    // should not keep the app polling every few seconds forever.
    if (_reconnectAttempts >= 6) {
      _reconnectTimer?.cancel();
      _reconnectTimer = null;
      running = false;
      status = null;
      _stopReconcileTimer();
      error ??= _tr('连接失败，请检查网络后重试');
      notifyListeners();
      return;
    }
    status = _tr('连接暂时中断，正在自动重连…');
    notifyListeners();
    _reconnectTimer?.cancel();
    final delaySeconds = (1 << _reconnectAttempts.clamp(0, 3));
    _reconnectAttempts += 1;
    _reconnectTimer = Timer(Duration(seconds: delaySeconds), () async {
      if (_disposed || activeSessionId != sessionId || !running) return;
      try {
        await _connectEvents(sessionId);
      } catch (_) {
        if (!_disposed && running) {
          _recoverEventStream(sessionId, _streamGeneration);
        }
      }
    });
  }

  void _handleEvent(Map<String, dynamic> event) {
    if (_disposed) return;
    _lastEventAt = DateTime.now();
    final type = event['type']?.toString();
    if (type == 'connected') {
      if (!(_connected?.isCompleted ?? true)) _connected!.complete();
      status = null;
      notifyListeners();
      return;
    }
    switch (type) {
      case 'agent_start':
        running = true;
        agentPhase = 'waiting_model';
        liveToolSteps.clear();
        _resetTokenRate();
      case 'message_start':
      case 'message_update':
        final value = event['message'];
        if (value is Map && value['role'] != 'user') {
          streamingMessage = ChatMessage.fromJson(
            Map<String, dynamic>.from(value),
            language: _language,
          );
          _trackTokenRate(streamingMessage);
        }
        // 高频流式更新走节流，避免每 chunk 全页 rebuild
        _notifyStreaming();
        return;
      case 'message_end':
        final value = event['message'];
        if (value is Map) {
          final json = Map<String, dynamic>.from(value);
          final completed = ChatMessage.fromJson(json, language: _language);
          if (completed.role != 'user') messages.add(completed);
          final modelError = json['errorMessage']?.toString();
          if (modelError != null && modelError.isNotEmpty) {
            error = _errorText(modelError);
          }
        }
        streamingMessage = null;
        unawaited(refreshSessionStats());
      case 'prompt_error':
        error = _errorText(event['errorMessage']?.toString() ?? _tr('消息发送失败'));
      case 'auto_retry_start':
        status = _tr('模型繁忙，正在自动重试…');
      case 'auto_retry_end':
        status = null;
        if (event['success'] == false && event['finalError'] != null) {
          error = _errorText(event['finalError'].toString());
        }
      case 'prompt_done':
      case 'agent_settled':
        running = false;
        status = null;
        streamingMessage = null;
        agentPhase = null;
        liveToolSteps.clear();
        _resetTokenRate();
        _markActiveSessionRunning(false);
        unawaited(refreshSessionStats());
        unawaited(_finishRun());
      case 'tool_execution_start':
        final name = event['toolName']?.toString() ?? _tr('工具');
        agentPhase = 'running_tools';
        liveToolSteps.add(
          LiveToolStep(
            name: name,
            toolCallId:
                event['toolCallId']?.toString() ??
                '${liveToolSteps.length}-$name',
            arguments: _toolArgsFromEvent(event),
            startedAt: DateTime.now(),
          ),
        );
        streamingMessage = ChatMessage(
          role: 'status',
          text: _tr('正在运行 {name}…', {'name': name}),
          toolName: name,
        );
      case 'tool_execution_end':
        final callId = event['toolCallId']?.toString();
        final step = callId == null
            ? liveToolSteps.lastOrNull
            : liveToolSteps
                  .where((item) => item.toolCallId == callId)
                  .lastOrNull;
        if (step != null) {
          step.finishedAt = DateTime.now();
          step.isError = event['isError'] == true;
          step.resultText = _toolResultText(event['result']);
        }
        if (liveToolSteps.every((item) => item.finishedAt != null)) {
          agentPhase = null;
        }
        streamingMessage = ChatMessage(role: 'status', text: _tr('正在整理结果…'));
    }
    notifyListeners();
  }

  /// 从 `tool_execution_start` 事件中提取工具参数（兼容多种字段名/嵌套位置）：
  /// pi 的事件 payload 里参数可能出现在 `arguments`/`args`/`input`，或嵌套在
  /// `entry.data` 里；bash 等工具的命令内容（`command`）由此进入实时卡片预览。
  Map<String, dynamic>? _toolArgsFromEvent(Map<String, dynamic> event) {
    Map<String, dynamic>? fromMap(Object? value) {
      if (value is Map) return Map<String, dynamic>.from(value);
      return null;
    }

    for (final key in const ['arguments', 'args', 'input']) {
      final direct = fromMap(event[key]);
      if (direct != null) return direct;
    }
    final entry = event['entry'];
    if (entry is Map) {
      final data = entry['data'];
      if (data is Map) {
        for (final key in const ['arguments', 'args', 'input']) {
          final nested = fromMap(data[key]);
          if (nested != null) return nested;
        }
        final call = data['toolCall'];
        if (call is Map) {
          final nested = fromMap(call['arguments'] ?? call['args']);
          if (nested != null) return nested;
        }
      }
    }
    return null;
  }

  /// Flattens a `tool_execution_end` result payload into displayable text.
  /// Handles both a plain string and the `{ content: [{type:'text',...}] }`
  /// shape used by pi's ToolResultMessage.
  String? _toolResultText(Object? result) {
    if (result is String) return result.isEmpty ? null : result;
    if (result is! Map) return null;
    final content = result['content'];
    if (content is List) {
      final texts = content
          .whereType<Map>()
          .map((block) => block['text']?.toString() ?? '')
          .where((text) => text.trim().isNotEmpty)
          .toList();
      return texts.isEmpty ? null : texts.join('\n');
    }
    final text = result['text']?.toString();
    return text == null || text.isEmpty ? null : text;
  }

  /// Full run-settle path: stops the reconcile watchdog, then refreshes the
  /// conversation snapshot. Called from prompt_done / agent_settled events.
  Future<void> _finishRun() async {
    _stopReconcileTimer();
    await _refreshRunSnapshot();
  }

  /// Refreshes the conversation + session list from the server. Deduplicated
  /// so concurrent callers (prompt_done + agent_settled + reconcile) do not
  /// fire overlapping requests or race on `messages`/`sessions`.
  Future<void> _refreshRunSnapshot() async {
    if (_snapshotInFlight) return;
    final id = activeSessionId;
    if (id == null) return;
    _snapshotInFlight = true;
    try {
      // Refresh the conversation and the session list in parallel; neither
      // depends on the other.
      final results = await Future.wait<Object?>([
        api.getSession(id),
        api.getSessions(),
      ]);
      // The user may have switched sessions or disposed the controller while
      // these requests were in flight; never let a stale snapshot clobber
      // the active conversation.
      if (_disposed || id != activeSessionId) return;
      final snapshot = results[0] as SessionSnapshot;
      messages
        ..clear()
        ..addAll(snapshot.messages);
      if (snapshot.model != null) selectedModel = snapshot.model;
      final loaded = (results[1] as List<PiSession>);
      loaded.sort((a, b) {
        final byDirectory = a.cwd.toLowerCase().compareTo(b.cwd.toLowerCase());
        return byDirectory != 0
            ? byDirectory
            : b.modified.compareTo(a.modified);
      });
      sessions
        ..clear()
        ..addAll(loaded);
      selectedSession = sessions.where((item) => item.id == id).firstOrNull;
    } catch (cause) {
      if (_disposed) return;
      error ??= _errorText(cause);
    } finally {
      _snapshotInFlight = false;
    }
    if (!_disposed) notifyListeners();
  }

  String _errorText(Object value) {
    final text = value is PiApiException
        ? value.message
        : value.toString().replaceFirst('Exception: ', '');
    if (value is TimeoutException) {
      return _tr('连接超时，请检查服务器地址和网络');
    }
    if (text.contains('ServerOverloaded') ||
        text.contains('TooManyRequests') ||
        text.contains('429')) {
      return _tr('模型服务当前繁忙（429），Pi 已自动重试但仍未成功。请稍后重试或切换模型。');
    }
    if (text.contains('ClientConnection') ||
        text.contains('Connection closed')) {
      return _tr('网络连接暂时中断，App 会自动重连。');
    }
    return text;
  }

  @override
  void dispose() {
    _disposed = true;
    _stopReconcileTimer();
    _disposeStreamThrottle();
    stopTasksPolling();
    // Invalidate any in-flight event stream so late callbacks (onDone, timer
    // retries) are discarded instead of touching disposed state.
    _streamGeneration += 1;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _eventSubscription?.cancel();
    api.close();
    super.dispose();
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
  T? get lastOrNull => isEmpty ? null : last;
}
