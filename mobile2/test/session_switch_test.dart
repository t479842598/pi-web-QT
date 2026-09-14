import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:pi_web_qt/src/chat_controller.dart';
import 'package:pi_web_qt/src/localization.dart';
import 'package:pi_web_qt/src/models.dart';
import 'package:pi_web_qt/src/pi_api.dart';

const _modelA = PiModel(provider: 'fake', id: 'a', name: 'A');
const _modelB = PiModel(provider: 'fake', id: 'b', name: 'B');
const _modelC = PiModel(provider: 'fake', id: 'c', name: 'C');

PiSession _session(String id, {bool running = false}) => PiSession(
  id: id,
  cwd: '/$id',
  created: DateTime(2026),
  modified: DateTime(2026),
  messageCount: 1,
  firstMessage: 'history $id',
  running: running,
);

SessionSnapshot _snapshot(String text) => SessionSnapshot(
  messages: [ChatMessage(role: 'assistant', text: text)],
);

SkillCatalog _skills(String name) => SkillCatalog(
  skills: [
    PiSkill(
      name: name,
      description: name,
      filePath: '/$name/SKILL.md',
      disableModelInvocation: false,
    ),
  ],
  diagnostics: [name],
  projectResourcesLoaded: true,
);

// Flush microtasks without relying on real network or wall-clock delays.
Future<void> _flush() => Future<void>.delayed(Duration.zero);

typedef _Prompt = ({String sessionId, String text, String? behavior});

class _EventFeed {
  _EventFeed(
    this.sessionId, {
    bool handshake = true,
    Future<void>? cancelDelay,
  }) {
    controller = StreamController<Map<String, dynamic>>(
      onListen: () {
        if (handshake && !controller.isClosed) add({'type': 'connected'});
      },
      onCancel: () {
        cancelled = true;
        return cancelDelay;
      },
    );
  }

  final String sessionId;
  late final StreamController<Map<String, dynamic>> controller;
  bool cancelled = false;

  Stream<Map<String, dynamic>> get stream => controller.stream;
  void add(Map<String, dynamic> event) => controller.add(event);
  void message(String text) => add({
    'type': 'message_end',
    'message': {'role': 'assistant', 'content': text},
  });
}

// Implements instead of extending PiApi: no HTTP client, sockets, settings or
// model provider can be reached. Unexpected API calls fail the test explicitly.
class _FakePiApi implements PiApi {
  @override
  final ServerProfile profile = ServerProfile(
    baseUrl: 'https://fake.invalid',
    username: '',
    password: '',
  );
  @override
  AppLanguage language = AppLanguage.zhHans;
  bool closed = false;
  final creates = <String>[];
  final sessionReads = <String>[];
  final eventRequests = <String>[];
  final commandReads = <String>[];
  final prompts = <_Prompt>[];
  final feeds = <_EventFeed>[];

  Future<String> Function(String cwd)? onCreate;
  Future<SessionSnapshot> Function(String id)? onSession;
  Future<Stream<Map<String, dynamic>>> Function(String id)? onEvents;
  Future<void> Function(_Prompt prompt)? onSend;
  Future<ModelCatalog> Function(String cwd)? onModels;
  Future<SkillCatalog> Function(String cwd)? onSkills;
  Future<void> Function(String id, PiModel model)? onSetModel;
  Future<Map<String, dynamic>> Function(String id)? onStats;
  Future<Map<String, dynamic>?> Function(String id)? onState;
  Future<List<PiSlashCommand>> Function(String id)? onCommands;
  Future<dynamic> Function(String id, Map<String, dynamic> command)? onCommand;
  Future<Map<String, dynamic>?> Function(Uri uri)? onRaw;

  void _checkOpen() {
    if (closed) throw StateError('API called after disposal');
  }

  _EventFeed feed(
    String id, {
    bool handshake = true,
    Future<void>? cancelDelay,
  }) {
    final value = _EventFeed(
      id,
      handshake: handshake,
      cancelDelay: cancelDelay,
    );
    feeds.add(value);
    return value;
  }

  @override
  Future<String> createSession(String cwd, {PiModel? model}) async {
    _checkOpen();
    creates.add(cwd);
    return onCreate == null
        ? 'created-${creates.length}'
        : await onCreate!(cwd);
  }

  @override
  Future<SessionSnapshot> getSession(String sessionId) async {
    _checkOpen();
    sessionReads.add(sessionId);
    return onSession == null
        ? _snapshot('history $sessionId')
        : await onSession!(sessionId);
  }

  @override
  Future<List<PiSession>> getSessions() async {
    _checkOpen();
    return [];
  }

  @override
  Future<Map<String, String>> getProjectAliases() async => {};

  @override
  Future<Stream<Map<String, dynamic>>> events(String sessionId) async {
    _checkOpen();
    eventRequests.add(sessionId);
    return onEvents == null
        ? feed(sessionId).stream
        : await onEvents!(sessionId);
  }

  @override
  Future<void> sendPrompt(
    String sessionId,
    String message, {
    List<PiImageAttachment> images = const [],
    String? streamingBehavior,
  }) async {
    _checkOpen();
    final prompt = (
      sessionId: sessionId,
      text: message,
      behavior: streamingBehavior,
    );
    prompts.add(prompt);
    await onSend?.call(prompt);
  }

  @override
  Future<ModelCatalog> getModels(String cwd) async {
    _checkOpen();
    return onModels == null
        ? const ModelCatalog(models: [_modelA, _modelB, _modelC])
        : await onModels!(cwd);
  }

  @override
  Future<SkillCatalog> getSkills(String cwd) async {
    _checkOpen();
    return onSkills == null ? _skills(cwd) : await onSkills!(cwd);
  }

  @override
  Future<void> setModel(String sessionId, PiModel model) async {
    _checkOpen();
    await onSetModel?.call(sessionId, model);
  }

  @override
  Future<Map<String, dynamic>?> getAgentState(String sessionId) async {
    _checkOpen();
    return await onState?.call(sessionId);
  }

  @override
  Future<Map<String, dynamic>> getSessionStats(String sessionId) async {
    _checkOpen();
    return onStats == null ? {} : await onStats!(sessionId);
  }

  @override
  Future<List<PiSlashCommand>> getSlashCommands(String sessionId) async {
    _checkOpen();
    commandReads.add(sessionId);
    return onCommands == null ? [] : await onCommands!(sessionId);
  }

  @override
  Future<dynamic> sendAgentCommand(
    String sessionId,
    Map<String, dynamic> command, {
    Duration timeout = const Duration(seconds: 20),
  }) async {
    _checkOpen();
    return await onCommand?.call(sessionId, command);
  }

  @override
  Future<Map<String, dynamic>?> getRaw(Uri uri) async {
    _checkOpen();
    return await onRaw?.call(uri);
  }

  @override
  void close() {
    closed = true;
    for (final feed in feeds) {
      unawaited(feed.controller.close());
    }
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected fake API call: ${invocation.memberName}');
}

void main() {
  late _FakePiApi api;
  late ChatController controller;

  setUp(() {
    api = _FakePiApi();
    controller = ChatController(api);
  });
  tearDown(() {
    if (!api.closed) controller.dispose();
  });

  test(
    'newChat clears and notifies synchronously without waiting for catalogs',
    () async {
      final models = Completer<ModelCatalog>();
      api.onModels = (_) => models.future;
      controller.messages.add(
        const ChatMessage(role: 'assistant', text: 'old'),
      );
      controller.loadingMessages = true;
      var notifications = 0;
      controller.addListener(() => notifications++);

      final draft = controller.newChat('/draft');
      expect(controller.messages, isEmpty);
      expect(controller.loadingMessages, isFalse);
      expect(controller.draftCwd, '/draft');
      expect(notifications, greaterThan(0));
      models.complete(const ModelCatalog(models: [_modelA]));
      await draft;
    },
  );

  for (final fail in [false, true]) {
    test('pending creation cannot take over B (failure=$fail)', () async {
      await controller.newChat('/A');
      final created = Completer<String>();
      api.onCreate = (_) => created.future;
      final sending = controller.send('for A');
      expect(api.creates, ['/A']);
      await controller.openSession(_session('B'));
      controller.error = 'B error';
      if (fail) {
        created.completeError(const PiApiException('old create failed'));
      } else {
        created.complete('A');
      }
      await sending;

      expect(controller.activeSessionId, 'B');
      expect(controller.selectedSession?.id, 'B');
      expect(controller.messages.single.text, 'history B');
      expect(controller.running, isFalse);
      expect(controller.error, 'B error');
      expect(api.eventRequests, isEmpty);
      expect(api.prompts, isEmpty);
    });
  }

  test(
    'pending creation cannot attach to another draft, even at the same cwd',
    () async {
      await controller.newChat('/same');
      final first = Completer<String>();
      final second = Completer<String>();
      api.onCreate = (_) =>
          api.creates.length == 1 ? first.future : second.future;
      final oldSend = controller.send('old draft');
      await controller.newChat('/same');
      final newSend = controller.send('new draft');
      first.complete('old-id');
      await oldSend;
      expect(controller.activeSessionId, isNull);
      expect(controller.messages.single.text, 'new draft');
      expect(controller.running, isTrue);
      expect(api.prompts, isEmpty);

      final commands = controller.loadSlashCommands();
      await _flush();
      expect(api.creates, [
        '/same',
        '/same',
      ], reason: 'old finally must not clear new ensure');
      second.complete('new-id');
      await Future.wait([newSend, commands]);
      expect(controller.activeSessionId, 'new-id');
      expect(api.prompts.single.sessionId, 'new-id');
      expect(api.prompts.single.text, 'new draft');
      expect(api.commandReads, ['new-id']);
    },
  );

  test('send and slash commands share one pending creation', () async {
    await controller.newChat('/A');
    final created = Completer<String>();
    api.onCreate = (_) => created.future;
    final sending = controller.send('hello');
    final commands = controller.loadSlashCommands();
    await _flush();
    expect(api.creates, ['/A']);
    created.complete('A');
    await Future.wait([sending, commands]);
    expect(api.creates, ['/A']);
    expect(api.eventRequests, ['A']);
    expect(api.prompts.single.sessionId, 'A');
    expect(api.commandReads, ['A']);
  });

  test(
    'switch while slash skills load cannot create a session in the new draft',
    () async {
      await controller.newChat('/A');
      final skills = Completer<SkillCatalog>();
      api.onSkills = (cwd) async =>
          cwd == '/A' ? await skills.future : _skills(cwd);
      final commands = controller.loadSlashCommands();
      await controller.newChat('/B');
      skills.complete(_skills('old'));
      expect(await commands, isEmpty);
      expect(api.creates, isEmpty);
      expect(api.commandReads, isEmpty);
      expect(controller.loadingSlashCommands, isFalse);
    },
  );

  for (final fail in [false, true]) {
    test(
      'late open A cannot complete B loading or replace its error (failure=$fail)',
      () async {
        final a = Completer<SessionSnapshot>();
        final b = Completer<SessionSnapshot>();
        api.onSession = (id) => id == 'A' ? a.future : b.future;
        final openA = controller.openSession(_session('A'));
        final openB = controller.openSession(_session('B'));
        controller.error = 'B error';
        if (fail) {
          a.completeError(const PiApiException('old open failed'));
        } else {
          a.complete(_snapshot('old A'));
        }
        await openA;
        expect(controller.loadingMessages, isTrue);
        expect(controller.error, 'B error');
        expect(controller.messages, isEmpty);
        b.complete(_snapshot('B content'));
        await openB;
        expect(controller.loadingMessages, isFalse);
        expect(controller.messages.single.text, 'B content');
      },
    );
  }

  test(
    'reopening the same session still invalidates an earlier open',
    () async {
      final old = Completer<SessionSnapshot>();
      api.onSession = (id) async => api.sessionReads.length == 1
          ? await old.future
          : _snapshot('latest $id');
      final oldOpen = controller.openSession(_session('A'));
      await controller.openSession(_session('B'));
      await controller.openSession(_session('A'));
      old.complete(_snapshot('stale A'));
      await oldOpen;
      expect(controller.messages.single.text, 'latest A');
    },
  );

  test(
    'open A event error cannot clear B loading in catch or finally',
    () async {
      final events = Completer<Stream<Map<String, dynamic>>>();
      api.onEvents = (_) => events.future;
      final openA = controller.openSession(_session('A', running: true));
      await _flush();
      expect(api.eventRequests, ['A']);
      final snapshot = Completer<SessionSnapshot>();
      api.onSession = (_) => snapshot.future;
      final openB = controller.openSession(_session('B'));
      events.completeError(const PiApiException('old event connection failed'));
      await openA;
      expect(controller.loadingMessages, isTrue);
      expect(controller.error, isNull);
      snapshot.complete(_snapshot('B'));
      await openB;
    },
  );

  test(
    'late event response is cancelled and cannot send A or replace B subscription',
    () async {
      await controller.openSession(_session('A'));
      final events = Completer<Stream<Map<String, dynamic>>>();
      final oldFeed = api.feed('A');
      api.onEvents = (id) async =>
          id == 'A' ? await events.future : api.feed(id).stream;
      final sending = controller.send('for A');
      await _flush();
      await controller.openSession(_session('B', running: true));
      final bFeed = api.feeds.singleWhere((feed) => feed.sessionId == 'B');
      events.complete(oldFeed.stream);
      await sending;
      expect(
        oldFeed.cancelled,
        isTrue,
        reason: 'draining an endless SSE is not cancellation',
      );
      expect(bFeed.cancelled, isFalse);
      expect(api.prompts, isEmpty);
      oldFeed.message('stale A');
      bFeed.message('live B');
      await _flush();
      expect(controller.messages.map((m) => m.text), ['history B', 'live B']);
      expect(controller.running, isTrue);
    },
  );

  test('switch during SSE handshake stops the unsent prompt', () async {
    await controller.openSession(_session('A'));
    api.onEvents = (id) async => api.feed(id, handshake: false).stream;
    final sending = controller.send('unsent A');
    await _flush();
    expect(api.eventRequests, ['A']);
    await controller.newChat('/B');
    await sending;
    expect(api.prompts, isEmpty);
    expect(api.feeds.single.cancelled, isTrue);
    expect(controller.activeSessionId, isNull);
    expect(controller.running, isFalse);
  });

  test(
    'slow old subscription cancellation cannot retake stream ownership',
    () async {
      final cancelled = Completer<void>();
      api.onEvents = (id) async =>
          api.feed(id, cancelDelay: id == 'A' ? cancelled.future : null).stream;
      await controller.openSession(_session('A', running: true));
      final sending = controller.send('old A');
      await _flush();
      await controller.openSession(_session('B', running: true));
      cancelled.complete();
      await sending;
      expect(api.eventRequests, ['A', 'B']);
      expect(api.prompts, isEmpty);
      api.feeds.last.message('B still connected');
      await _flush();
      expect(controller.messages.last.text, 'B still connected');
    },
  );

  for (final queued in [false, true]) {
    for (final fail in [false, true]) {
      test(
        'in-flight send A leaves B alone (queued=$queued, failure=$fail)',
        () async {
          await controller.openSession(_session('A'));
          controller.running = queued;
          final sent = Completer<void>();
          api.onSend = (prompt) async {
            if (prompt.sessionId == 'A') await sent.future;
          };
          final sending = controller.send(
            'for A',
            queueMode: queued ? 'followUp' : null,
          );
          await _flush();
          expect(api.prompts.single.sessionId, 'A');
          expect(api.prompts.single.behavior, queued ? 'followUp' : null);
          await controller.openSession(_session('B'));
          await controller.send('for B');
          controller.error = 'B error';
          controller.status = 'B status';
          if (fail) {
            sent.completeError(const PiApiException('A send failed'));
          } else {
            sent.complete();
          }
          await sending;
          expect(controller.activeSessionId, 'B');
          expect(controller.messages.map((m) => m.text), [
            'history B',
            'for B',
          ]);
          expect(controller.running, isTrue);
          expect(controller.error, 'B error');
          expect(controller.status, 'B status');
          expect(api.prompts.map((p) => p.sessionId), ['A', 'B']);
        },
      );
    }
  }

  test(
    'failed queue removes only its own placeholder, not a later message',
    () async {
      await controller.openSession(_session('A'));
      controller.running = true;
      final sent = Completer<void>();
      api.onSend = (_) => sent.future;
      final sending = controller.send('queued', queueMode: 'steer');
      await _flush();
      controller.messages.add(
        const ChatMessage(role: 'assistant', text: 'later'),
      );
      sent.completeError(const PiApiException('queue failed'));
      await sending;
      expect(controller.messages.map((m) => m.text), ['history A', 'later']);
      expect(controller.running, isTrue);
      expect(controller.error, 'queue failed');
    },
  );

  for (final fail in [false, true]) {
    test(
      'old catalogs cannot overwrite B or clear B loading (failure=$fail)',
      () async {
        final modelsA = Completer<ModelCatalog>();
        final modelsB = Completer<ModelCatalog>();
        final skillsA = Completer<SkillCatalog>();
        final skillsB = Completer<SkillCatalog>();
        api.onModels = (cwd) => cwd == '/A' ? modelsA.future : modelsB.future;
        api.onSkills = (cwd) => cwd == '/A' ? skillsA.future : skillsB.future;
        final a = controller.newChat('/A');
        final b = controller.newChat('/B');
        if (fail) {
          modelsA.completeError(const PiApiException('old models error'));
          skillsA.completeError(const PiApiException('old skills error'));
        } else {
          modelsA.complete(const ModelCatalog(models: [_modelA]));
          skillsA.complete(_skills('A'));
        }
        await a;
        expect(controller.loadingModels, isTrue);
        expect(controller.loadingSkills, isTrue);
        expect(controller.models, isEmpty);
        expect(controller.skills, isEmpty);
        expect(controller.error, isNull);
        expect(controller.skillsError, isNull);
        modelsB.complete(const ModelCatalog(models: [_modelB]));
        skillsB.complete(_skills('B'));
        await b;
        expect(controller.selectedModel, _modelB);
        expect(controller.skills.single.name, 'B');
        expect(controller.skillDiagnostics, ['B']);
      },
    );
  }

  test('latest catalog request wins within the same draft', () async {
    final oldModels = Completer<ModelCatalog>();
    final oldSkills = Completer<SkillCatalog>();
    api.onModels = (cwd) async => cwd == '/old'
        ? await oldModels.future
        : const ModelCatalog(models: [_modelB]);
    api.onSkills = (cwd) async =>
        cwd == '/old' ? await oldSkills.future : _skills('B');
    final old = Future.wait([
      controller.loadModels('/old'),
      controller.loadSkills('/old'),
    ]);
    await Future.wait([
      controller.loadModels('/new'),
      controller.loadSkills('/new'),
    ]);
    oldModels.complete(const ModelCatalog(models: [_modelA]));
    oldSkills.complete(_skills('A'));
    await old;
    expect(controller.selectedModel, _modelB);
    expect(controller.skills.single.name, 'B');
  });

  for (final fail in [false, true]) {
    test(
      'old model selection cannot clear a new selection (failure=$fail)',
      () async {
        await controller.openSession(_session('A'));
        final old = Completer<void>();
        final current = Completer<void>();
        api.onSetModel = (id, _) => id == 'A' ? old.future : current.future;
        final selectingA = controller.selectModel(_modelB);
        await controller.openSession(_session('B'));
        expect(controller.changingModel, isFalse);
        final selectingB = controller.selectModel(_modelC);
        if (fail) {
          old.completeError(const PiApiException('old model failed'));
        } else {
          old.complete();
        }
        await selectingA;
        expect(controller.changingModel, isTrue);
        expect(controller.selectedModel, _modelA);
        expect(controller.error, isNull);
        current.complete();
        await selectingB;
        expect(controller.selectedModel, _modelC);
        expect(controller.changingModel, isFalse);
      },
    );
  }

  test(
    'late stats cannot overwrite or unlock a new session stats request',
    () async {
      final a = Completer<Map<String, dynamic>>();
      final b = Completer<Map<String, dynamic>>();
      api.onStats = (id) => id == 'A' ? a.future : b.future;
      await controller.openSession(_session('A'));
      await controller.openSession(_session('B'));
      a.complete({'contextTokens': 123});
      await _flush();
      expect(controller.contextTokens, isNull);
      expect(controller.loadingStats, isTrue);
      b.complete({'contextTokens': 456});
      await _flush();
      expect(controller.contextTokens, 456);
      expect(controller.loadingStats, isFalse);
    },
  );

  test('old compact completion neither refreshes nor resets B', () async {
    await controller.openSession(_session('A'));
    final compact = Completer<void>();
    api.onCommand = (_, _) => compact.future;
    final command = controller.executeBuiltinCommand('/compact');
    await _flush();
    expect(controller.compacting, isTrue);
    await controller.openSession(_session('B'));
    await controller.send('B running');
    compact.complete();
    final result = await command;
    expect(result.handled, isTrue);
    expect(result.message, isNull);
    expect(controller.compacting, isFalse);
    expect(controller.running, isTrue);
    expect(controller.messages.last.text, 'B running');
    expect(api.sessionReads, ['A', 'B']);
  });

  test('snapshot error after settling A cannot surface in B', () async {
    await controller.openSession(_session('A', running: true));
    final snapshot = Completer<SessionSnapshot>();
    api.onSession = (id) async =>
        id == 'A' ? await snapshot.future : _snapshot('B');
    api.feeds.single.add({'type': 'prompt_done'});
    await _flush();
    await controller.openSession(_session('B'));
    controller.error = 'B error';
    snapshot.completeError(const PiApiException('old refresh failed'));
    await _flush();
    expect(controller.messages.single.text, 'B');
    expect(controller.error, 'B error');
  });

  for (final phase in ['create', 'events', 'handshake', 'send', 'open']) {
    test(
      'dispose invalidates pending $phase without more requests or notifications',
      () async {
        final created = Completer<String>();
        final events = Completer<Stream<Map<String, dynamic>>>();
        final sent = Completer<void>();
        final snapshot = Completer<SessionSnapshot>();
        Future<void> pending;
        if (phase == 'open') {
          api.onSession = (_) => snapshot.future;
          pending = controller.openSession(_session('A'));
        } else {
          await controller.newChat('/A');
          if (phase == 'create') api.onCreate = (_) => created.future;
          if (phase == 'events') api.onEvents = (_) => events.future;
          if (phase == 'handshake') {
            api.onEvents = (id) async => api.feed(id, handshake: false).stream;
          }
          if (phase == 'send') api.onSend = (_) => sent.future;
          pending = controller.send('A');
        }
        await _flush();
        var notifications = 0;
        controller.addListener(() => notifications++);
        final id = controller.activeSessionId;
        final requestCount = api.prompts.length;
        final beforeMessages = controller.messages.toList();
        controller.dispose();
        if (phase == 'create') created.complete('late A');
        if (phase == 'events') events.complete(api.feed('late A').stream);
        if (phase == 'send') {
          sent.completeError(const PiApiException('late send error'));
        }
        if (phase == 'open') snapshot.complete(_snapshot('late open'));
        await pending;
        expect(controller.activeSessionId, id);
        expect(controller.messages, beforeMessages);
        expect(controller.error, isNull);
        expect(api.prompts.length, requestCount);
        expect(notifications, 0);
        for (final feed in api.feeds) {
          expect(feed.cancelled, isTrue);
        }
      },
    );
  }
}
