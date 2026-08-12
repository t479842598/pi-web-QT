import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'models.dart';
import 'pi_api.dart';
import 'localization.dart';

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
  String? skillsError;
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

  Future<void> initialize() async {
    await refreshSessions();
    final cwd = draftCwd;
    if (cwd != null) {
      await Future.wait([loadModels(cwd), loadSkills(cwd)]);
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
    } catch (cause) {
      error = _errorText(cause);
      rethrow;
    } finally {
      loadingSessions = false;
      notifyListeners();
    }
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
      notifyListeners();
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
      notifyListeners();
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
      notifyListeners();
    }
  }

  Future<DirectoryListing> browseDirectories([String? path]) =>
      api.browseDirectories(path);

  Future<String> createDirectory(String parentPath, String name) =>
      api.createDirectory(parentPath, name);

  Future<void> openSession(PiSession session) async {
    await _closeEvents();
    if (activeSessionId != session.id) {
      slashCommands.clear();
      slashCommandsForSessionId = null;
    }
    selectedSession = session;
    activeSessionId = session.id;
    draftCwd = session.cwd;
    streamingMessage = null;
    running = session.running;
    loadingMessages = true;
    error = null;
    status = null;
    messages.clear();
    notifyListeners();
    try {
      final snapshot = await api.getSession(session.id);
      messages.addAll(snapshot.messages);
      await Future.wait([
        loadModels(session.cwd, preferred: snapshot.model),
        loadSkills(session.cwd),
      ]);
      if (running) await _connectEvents(session.id);
    } catch (cause) {
      error = _errorText(cause);
    } finally {
      loadingMessages = false;
      notifyListeners();
    }
  }

  Future<void> newChat(String cwd, {PiModel? model}) async {
    await _closeEvents();
    selectedSession = null;
    activeSessionId = null;
    draftCwd = cwd;
    messages.clear();
    streamingMessage = null;
    running = false;
    error = null;
    status = null;
    slashCommands.clear();
    slashCommandsForSessionId = null;
    await Future.wait([loadModels(cwd, preferred: model), loadSkills(cwd)]);
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
      notifyListeners();
      try {
        await refreshSessions();
      } catch (_) {
        // The server deletion succeeded. Keep the local list updated even if
        // the follow-up refresh temporarily fails.
      }
    } catch (cause) {
      error = _errorText(cause);
      notifyListeners();
      rethrow;
    } finally {
      deletingSessionIds.remove(session.id);
      notifyListeners();
    }
  }

  Future<void> send(
    String text, {
    List<PiImageAttachment> images = const [],
  }) async {
    final message = text.trim();
    if ((message.isEmpty && images.isEmpty) || running) return;
    error = null;
    status = null;
    final imageLabel = images.isEmpty
        ? ''
        : images.length == 1
        ? _tr('[图片]')
        : _tr('[图片 × {count}]', {'count': images.length});
    messages.add(
      ChatMessage(
        role: 'user',
        text: message.isEmpty
            ? imageLabel
            : imageLabel.isEmpty
            ? message
            : '$message\n\n$imageLabel',
      ),
    );
    running = true;
    notifyListeners();

    try {
      final sessionId = await _ensureSession();
      await _connectEvents(sessionId);
      await api.sendPrompt(sessionId, message, images: images);
    } catch (cause) {
      running = false;
      error = _errorText(cause);
      notifyListeners();
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
      notifyListeners();
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

  Future<String> _ensureSession() async {
    final existing = activeSessionId;
    if (existing != null) return existing;
    final cwd = draftCwd?.trim();
    if (cwd == null || cwd.isEmpty) {
      throw PiApiException(_tr('请先选择工作目录'));
    }
    final sessionId = await api.createSession(cwd, model: selectedModel);
    activeSessionId = sessionId;
    notifyListeners();
    return sessionId;
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
        notifyListeners();
      } else {
        await api.abort(id);
      }
    } catch (cause) {
      error = _errorText(cause);
      notifyListeners();
    }
  }

  void dismissError() {
    error = null;
    notifyListeners();
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
    notifyListeners();
  }

  Future<void> _closeEvents() async {
    _streamGeneration += 1;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
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
    if (_disposed || generation != _streamGeneration) return;
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
    await connected.future.timeout(const Duration(seconds: 10));
    if (generation == _streamGeneration) {
      _reconnectAttempts = 0;
      status = null;
      notifyListeners();
    }
  }

  void _recoverEventStream(String sessionId, int generation) {
    if (_disposed || generation != _streamGeneration || !running) return;
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
      case 'message_start':
      case 'message_update':
        final value = event['message'];
        if (value is Map && value['role'] != 'user') {
          streamingMessage = ChatMessage.fromJson(
            Map<String, dynamic>.from(value),
            language: _language,
          );
        }
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
        unawaited(_finishRun());
      case 'tool_execution_start':
        final name = event['toolName']?.toString() ?? _tr('工具');
        streamingMessage = ChatMessage(
          role: 'status',
          text: _tr('正在运行 {name}…', {'name': name}),
          toolName: name,
        );
      case 'tool_execution_end':
        streamingMessage = ChatMessage(role: 'status', text: _tr('正在整理结果…'));
    }
    notifyListeners();
  }

  Future<void> _finishRun() async {
    final id = activeSessionId;
    if (id != null) {
      try {
        final snapshot = await api.getSession(id);
        messages
          ..clear()
          ..addAll(snapshot.messages);
        if (snapshot.model != null) selectedModel = snapshot.model;
        final loaded = await api.getSessions();
        loaded.sort((a, b) {
          final byDirectory = a.cwd.toLowerCase().compareTo(
            b.cwd.toLowerCase(),
          );
          return byDirectory != 0
              ? byDirectory
              : b.modified.compareTo(a.modified);
        });
        sessions
          ..clear()
          ..addAll(loaded);
        selectedSession = sessions.where((item) => item.id == id).firstOrNull;
      } catch (cause) {
        error ??= _errorText(cause);
      }
    }
    notifyListeners();
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
    _reconnectTimer?.cancel();
    _eventSubscription?.cancel();
    api.close();
    super.dispose();
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
