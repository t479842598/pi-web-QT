import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_web_qt/src/chat_controller.dart';
import 'package:pi_web_qt/src/localization.dart';
import 'package:pi_web_qt/src/models.dart';
import 'package:pi_web_qt/src/pi_api.dart';
import 'package:pi_web_qt/src/screens/chat_screen.dart';
import 'package:pi_web_qt/src/screens/directory_picker.dart';
import 'package:pi_web_qt/src/screens/login_screen.dart';

void main() {
  test('resolves supported system languages and falls back to English', () {
    expect(
      resolveAppLanguage(AppLanguagePreference.system, const [
        Locale('zh', 'CN'),
      ]),
      AppLanguage.zhHans,
    );
    expect(
      resolveAppLanguage(AppLanguagePreference.system, const [Locale('ja')]),
      AppLanguage.ja,
    );
    expect(
      resolveAppLanguage(AppLanguagePreference.system, const [Locale('fr')]),
      AppLanguage.en,
    );
    expect(
      resolveAppLanguage(AppLanguagePreference.system, const [
        Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant'),
      ]),
      AppLanguage.en,
    );
  });

  test('provides Japanese and English interface text', () {
    expect(AppLocalizations.text(AppLanguage.ja, '功能与显示'), '機能と表示');
    expect(
      AppLocalizations.text(AppLanguage.en, '选择工作目录'),
      'Choose working directory',
    );
  });

  testWidgets('renders the login screen in English', (tester) async {
    await tester.pumpWidget(
      AppLanguageScope(
        language: AppLanguage.en,
        preference: AppLanguagePreference.en,
        onPreferenceChanged: (_) {},
        child: MaterialApp(home: LoginScreen(onLogin: (_) async {})),
      ),
    );

    expect(find.text('Connect to your Pi'), findsOneWidget);
    expect(find.text('Server address'), findsOneWidget);
    expect(find.text('Password (optional)'), findsOneWidget);
  });

  test('normalizes server addresses', () {
    expect(
      normalizeServerUrl('192.168.1.10:6004/'),
      'http://192.168.1.10:6004',
    );
    expect(
      normalizeServerUrl('https://pi.example.com/'),
      'https://pi.example.com',
    );
    expect(
      () => normalizeServerUrl('ftp://example.com'),
      throwsFormatException,
    );
  });

  test('extracts text and tool calls from assistant content', () {
    final text = messageText({
      'role': 'assistant',
      'content': [
        {'type': 'text', 'text': '完成'},
        {'type': 'toolCall', 'toolName': 'bash'},
      ],
    });
    expect(text, contains('完成'));
    expect(text, isNot(contains('bash')));
    expect(
      messageProcessText({
        'role': 'assistant',
        'content': [
          {'type': 'toolCall', 'toolName': 'bash'},
        ],
      }),
      contains('bash'),
    );
  });

  test('keeps thinking separate from the visible answer', () {
    final message = ChatMessage.fromJson({
      'role': 'assistant',
      'content': [
        {'type': 'thinking', 'thinking': '内部分析过程'},
        {'type': 'text', 'text': '最终答案'},
      ],
    });
    expect(message.text, '最终答案');
    expect(message.thinking, '内部分析过程');
    expect(message.text, isNot(contains('内部分析过程')));
  });

  test('extracts deferred thinking references from content block ids', () {
    final message = ChatMessage.fromJson({
      'role': 'assistant',
      'content': [
        {'type': 'thinking', 'thinking': '', 'id': 'entry-abc:3'},
        {'type': 'text', 'text': '最终答案'},
      ],
    });
    expect(message.thinking, isEmpty);
    expect(message.thinkingEntryId, 'entry-abc');
    expect(message.thinkingBlockIndex, 3);

    // Already-loaded thinking has no deferred reference.
    final loaded = ChatMessage.fromJson({
      'role': 'assistant',
      'content': [
        {'type': 'thinking', 'thinking': '已有内容'},
      ],
    });
    expect(loaded.thinkingEntryId, isNull);
    expect(loaded.thinkingBlockIndex, isNull);
  });

  test('keeps model errors visible in the conversation', () {
    final message = ChatMessage.fromJson({
      'role': 'assistant',
      'content': [],
      'stopReason': 'error',
      'errorMessage': '429 ServerOverloaded',
    });
    expect(message.text, contains('429 ServerOverloaded'));
  });

  test('parses models and directory entries', () {
    final model = PiModel.fromJson({
      'provider': 'provider-a',
      'id': 'model-a',
      'name': 'Model A',
    });
    final directory = DirectoryEntry.fromJson({
      'name': 'code',
      'path': '/mnt/code',
    });
    expect(model.key, 'provider-a:model-a');
    expect(directory.path, '/mnt/code');
  });

  test('parses git status into typed file entries', () {
    final status = GitStatus.fromJson({
      'isGitRepository': true,
      'repositoryRoot': '/mnt/code',
      'additions': 12,
      'deletions': 3,
      'files': [
        {
          'filePath': '/mnt/code/lib/main.dart',
          'status': 'modified',
          'indexStatus': null,
          'worktreeStatus': 'modified',
        },
        {
          'filePath': '/mnt/code/notes/new.md',
          'status': 'untracked',
          'indexStatus': null,
          'worktreeStatus': null,
        },
      ],
    });
    expect(status.isGitRepository, isTrue);
    expect(status.additions, 12);
    expect(status.deletions, 3);
    expect(status.files.length, 2);
    expect(status.files.first.status, 'modified');
    expect(status.files.first.fileName, 'main.dart');
    expect(status.files.last.status, 'untracked');
  });

  test('serializes image attachments for Pi prompts', () {
    const image = PiImageAttachment(data: 'aGVsbG8=', mimeType: 'image/png');
    expect(image.toJson(), {
      'type': 'image',
      'data': 'aGVsbG8=',
      'mimeType': 'image/png',
    });
  });

  test('parses loaded skill details', () {
    final skill = PiSkill.fromJson({
      'name': 'code-review',
      'description': '检查代码问题',
      'filePath': '/mnt/code/.agents/skills/code-review/SKILL.md',
      'disableModelInvocation': false,
      'sourceInfo': {'source': 'project', 'scope': 'project'},
    });
    expect(skill.name, 'code-review');
    expect(skill.description, '检查代码问题');
    expect(skill.sourceLabel, '项目');
    expect(skill.disableModelInvocation, isFalse);
  });

  test('converts raw directory maps before creating the typed list', () {
    final listing = DirectoryListing.fromJson({
      'path': '/mnt',
      'parentPath': '/',
      'directories': [
        {'name': 'code', 'path': '/mnt/code'},
        {'name': 'data', 'path': '/mnt/data'},
      ],
    });
    expect(listing.directories.map((entry) => entry.name), ['code', 'data']);
    expect(listing.parentPath, '/');
  });

  test('waits for long-running compaction and exposes its progress', () async {
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final api = _CompactTestApi(profile);
    final controller = ChatController(api)
      ..activeSessionId = 'session-a'
      ..draftCwd = '/mnt/code'
      ..messages.add(const ChatMessage(role: 'assistant', text: '回答'));
    addTearDown(controller.dispose);

    final pending = controller.executeBuiltinCommand('/compact 保留关键结论');
    await Future<void>.delayed(Duration.zero);

    expect(controller.compacting, isTrue);
    expect(controller.running, isTrue);
    expect(controller.status, '正在压缩对话上下文…');
    expect(api.command?['type'], 'compact');
    expect(api.command?['customInstructions'], '保留关键结论');
    expect(api.timeout, const Duration(minutes: 10));

    api.compaction.complete(const {});
    final result = await pending;
    expect(result.error, isNull);
    expect(result.message, '已压缩对话上下文');
    expect(controller.compacting, isFalse);
    expect(controller.running, isFalse);
    expect(controller.status, isNull);
  });

  testWidgets('shows Pi login fields', (tester) async {
    ServerProfile? submittedProfile;
    await tester.pumpWidget(
      MaterialApp(
        home: LoginScreen(
          onLogin: (profile) async => submittedProfile = profile,
        ),
      ),
    );
    expect(find.text('连接你的 Pi'), findsOneWidget);
    expect(find.text('服务器地址'), findsOneWidget);
    expect(find.text('账号'), findsNothing);
    expect(find.text('密码（可选）'), findsOneWidget);
    expect(find.text('登录'), findsOneWidget);

    await tester.enterText(
      find.byType(TextField).first,
      'https://pi.example.test',
    );
    await tester.tap(find.text('登录'));
    await tester.pump();

    expect(submittedProfile?.username, 'pi');
    expect(submittedProfile?.password, isEmpty);
  });

  testWidgets('shows streamlined toolbar, model picker, and cwd groups', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    const modelA = PiModel(
      provider: 'provider-a',
      id: 'model-a',
      name: 'Model A',
    );
    final controller = _NewChatTestController(profile)
      ..draftCwd = '/mnt/code'
      ..selectedModel = modelA
      ..models.addAll([
        modelA,
        const PiModel(provider: 'provider-b', id: 'model-b', name: 'Model B'),
      ])
      ..skills.addAll([
        const PiSkill(
          name: '代码审查',
          description: '检查代码中的错误和风险。',
          filePath: '/mnt/code/.agents/skills/review/SKILL.md',
          disableModelInvocation: false,
          source: 'project',
          scope: 'project',
        ),
        const PiSkill(
          name: '旧版发布',
          description: '仅在需要旧发布流程时使用。',
          filePath: '/mnt/code/.agents/skills/legacy-release/SKILL.md',
          disableModelInvocation: true,
          source: 'project',
          scope: 'project',
        ),
      ])
      ..messages.add(const ChatMessage(role: 'assistant', text: '测试回答'))
      ..sessions.addAll([
        PiSession(
          id: 'one',
          cwd: '/mnt/code',
          created: DateTime(2026),
          modified: DateTime(2026, 1, 2),
          messageCount: 2,
          firstMessage: '代码会话',
        ),
        PiSession(
          id: 'two',
          cwd: '/mnt/other',
          created: DateTime(2026),
          modified: DateTime(2026, 1, 1),
          messageCount: 2,
          firstMessage: '其他会话',
        ),
      ]);
    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          onLogout: () async {},
        ),
      ),
    );
    final chatScrollbar = find.byWidgetPredicate(
      (widget) => widget is RawScrollbar,
    );
    expect(chatScrollbar, findsOneWidget);
    expect(tester.widget<RawScrollbar>(chatScrollbar).thickness, 4);
    expect(tester.widget<RawScrollbar>(chatScrollbar).interactive, isTrue);
    expect(find.text('Model A'), findsOneWidget);
    expect(find.byTooltip('新建对话'), findsNothing);
    expect(find.byKey(const Key('add-menu')), findsOneWidget);
    expect(find.byKey(const Key('composer-single-line')), findsOneWidget);
    final composer = tester.widget<Container>(
      find.byKey(const Key('chat-composer')),
    );
    expect(composer.constraints?.minHeight, 50);
    expect(
      (composer.decoration! as BoxDecoration).borderRadius,
      BorderRadius.circular(999),
    );
    expect(find.byIcon(Icons.mic), findsNothing);
    expect(find.text('生成图片'), findsNothing);
    expect(find.text('撰写或编辑'), findsNothing);
    expect(find.text('搜索网页'), findsNothing);

    await tester.enterText(
      find.byType(TextField).last,
      '这是一段足够长的测试文字，用于确认输入框自动换行后会纵向展开，并且发送按钮不会遮挡文字内容。',
    );
    await tester.pump();
    // The composer uses a single stable structure (buttons stay on the right,
    // the text field grows vertically) so the IME composition is never
    // interrupted by a layout switch.
    expect(find.byKey(const Key('composer-single-line')), findsOneWidget);
    expect(find.byTooltip('发送'), findsOneWidget);
    await tester.enterText(find.byType(TextField).last, '');
    await tester.pump();
    expect(find.byKey(const Key('composer-single-line')), findsOneWidget);

    await tester.tap(find.byTooltip('打开对话菜单'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('drawer-new-chat-button')), findsOneWidget);
    await tester.tap(find.byKey(const Key('drawer-new-chat-button')));
    await tester.pumpAndSettle();
    expect(controller.newChatCwd, '/mnt/code');
    expect(controller.newChatModel, modelA);
    expect(find.text('选择工作目录'), findsNothing);

    await tester.tap(find.byTooltip('选择模型'));
    await tester.pumpAndSettle();
    expect(find.text('选择模型'), findsOneWidget);
    expect(find.text('当前：Model A · provider-a'), findsOneWidget);
    expect(find.text('provider-b / model-b'), findsOneWidget);
    expect(
      find.byWidgetPredicate((widget) => widget is RawScrollbar),
      findsWidgets,
    );
    Navigator.of(tester.element(find.text('选择模型'))).pop();
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('打开对话菜单'));
    await tester.pumpAndSettle();
    // Recent-project chips repeat folder names next to the grouped list, so
    // expect the grouping subtitle (unique) and the chips to both be present.
    expect(find.textContaining('1 个对话'), findsNWidgets(2));
    expect(find.byType(ActionChip), findsNWidgets(2));
    expect(
      find.byWidgetPredicate((widget) => widget is RawScrollbar),
      findsWidgets,
    );

    expect(find.text('技能'), findsNothing);
    expect(find.text('选择工作目录'), findsNothing);
    expect(find.text('切换服务器'), findsOneWidget);
    expect(find.text('退出登录'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('keeps a long model name inside the toolbar on narrow screens', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    const longModel = PiModel(
      provider: 'provider-a',
      id: 'deepseek-v4-flash',
      name: 'deepseek-v4-flash',
    );
    final controller = _NewChatTestController(profile)
      ..draftCwd = '/mnt/code'
      ..selectedModel = longModel
      ..models.add(longModel);
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          onLogout: () async {},
        ),
      ),
    );

    final modelPicker = find.byKey(const Key('top-model-picker'));
    final functionButton = find.byKey(const Key('function-display-button'));
    expect(modelPicker, findsOneWidget);
    expect(functionButton, findsOneWidget);
    expect(
      tester.getRect(modelPicker).right,
      lessThanOrEqualTo(tester.getRect(functionButton).left),
    );

    final modelLabel = tester.widget<Text>(find.text('deepseek-v4-flash'));
    expect(modelLabel.maxLines, 1);
    expect(modelLabel.overflow, isNull);
    expect(
      find.ancestor(
        of: find.text('deepseek-v4-flash'),
        matching: find.byType(FittedBox),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('thinking is collapsed until the user expands it', (
    tester,
  ) async {
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile))
      ..draftCwd = '/mnt/code'
      ..messages.add(
        const ChatMessage(role: 'assistant', text: '最终答案', thinking: '内部分析过程'),
      );
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('思考过程'), findsOneWidget);
    expect(find.text('内部分析过程'), findsNothing);

    await tester.tap(find.text('思考过程'));
    await tester.pumpAndSettle();
    expect(find.text('内部分析过程'), findsOneWidget);
  });

  testWidgets('deletes a session after explicit confirmation', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final api = _DeleteTestApi(profile);
    final session = PiSession(
      id: 'delete-me',
      cwd: '/mnt/code',
      created: DateTime(2026),
      modified: DateTime(2026),
      messageCount: 2,
      firstMessage: '待删除对话',
    );
    final controller = ChatController(api)
      ..draftCwd = session.cwd
      ..selectedSession = session
      ..activeSessionId = session.id
      ..sessions.add(session)
      ..messages.add(const ChatMessage(role: 'assistant', text: '将被删除'));
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          onLogout: () async {},
        ),
      ),
    );
    await tester.tap(find.byTooltip('打开对话菜单'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delete-session-delete-me')));
    await tester.pumpAndSettle();
    expect(find.text('删除对话？'), findsOneWidget);
    expect(find.textContaining('此操作无法撤销'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, '删除'));
    await tester.pumpAndSettle();
    expect(api.deletedSessionId, 'delete-me');
    expect(controller.sessions, isEmpty);
    expect(controller.activeSessionId, isNull);
    expect(controller.messages, isEmpty);
    expect(find.text('对话已删除'), findsOneWidget);
  });

  testWidgets(
    'slash input shows built-in and skill commands in compact chip view',
    (tester) async {
      final profile = ServerProfile(
        baseUrl: 'https://example.test',
        username: 'pi',
        password: 'test-only',
      );
      final api = _SlashTestApi(profile);
      final controller = ChatController(api)..draftCwd = '/mnt/code';
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        MaterialApp(
          home: ChatScreen(
            controller: controller,
            profile: profile,
            onLogout: () async {},
          ),
        ),
      );
      await tester.enterText(find.byType(TextField).last, '/');
      await tester.pumpAndSettle();
      expect(api.createdSession, isTrue);
      // Compact mode: chips visible, no group headers
      expect(find.text('/compact'), findsOneWidget);
      expect(
        controller.slashCommands.any((item) => item.name == 'skill:review'),
        isTrue,
      );

      await tester.enterText(find.byType(TextField).last, '/skill:r');
      await tester.pump();
      expect(find.text('/skill:review'), findsNothing);
      expect(find.text('没有找到匹配命令'), findsOneWidget);
      expect(find.text('/compact'), findsNothing);

      await tester.enterText(find.byType(TextField).last, '/skill:b');
      await tester.pump();
      expect(find.text('/skill:build'), findsOneWidget);
      expect(find.text('/skill:review'), findsNothing);

      await tester.tap(find.text('/skill:build'));
      await tester.pump();
      expect(find.byType(TextField).last, findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField).last).controller!.text,
        '/skill:build ',
      );
      expect(find.text('/skill:build'), findsNothing);
    },
  );

  testWidgets('slash command palette toggle between compact and list view', (
    tester,
  ) async {
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final api = _SlashTestApi(profile);
    final controller = ChatController(api)..draftCwd = '/mnt/code';
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          onLogout: () async {},
        ),
      ),
    );
    await tester.enterText(find.byType(TextField).last, '/');
    await tester.pumpAndSettle();

    // Default: compact chips — group headers not visible
    expect(find.text('内置'), findsNothing);
    expect(find.text('/compact'), findsOneWidget);

    // Toggle to list view — group headers now visible
    final toggle = find.byIcon(Icons.view_list_rounded);
    expect(toggle, findsOneWidget);
    await tester.tap(toggle);
    await tester.pump();
    expect(find.text('内置'), findsOneWidget);
    expect(find.text('/compact'), findsOneWidget);

    // Toggle back to compact — group headers hidden again
    final toggleBack = find.byIcon(Icons.grid_view_rounded);
    expect(toggleBack, findsOneWidget);
    await tester.tap(toggleBack);
    await tester.pump();
    expect(find.text('内置'), findsNothing);
  });

  testWidgets('completed turns fold process details like the web client', (
    tester,
  ) async {
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile))
      ..draftCwd = '/mnt/code'
      ..messages.addAll([
        const ChatMessage(role: 'user', text: '处理这个任务'),
        const ChatMessage(
          role: 'assistant',
          text: '',
          thinking: '先分析问题',
          processText: '调用工具：`bash`',
          toolCallCount: 1,
        ),
        const ChatMessage(role: 'toolResult', text: '工具输出'),
        const ChatMessage(role: 'assistant', text: '最终完成结果'),
      ]);
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('处理详情 · 2 条消息 · 1 个工具调用'), findsOneWidget);
    expect(find.text('最终完成结果'), findsOneWidget);
    expect(find.text('工具输出'), findsNothing);

    await tester.tap(find.text('处理详情 · 2 条消息 · 1 个工具调用'));
    await tester.pumpAndSettle();
    expect(find.text('工具输出'), findsOneWidget);
    expect(find.text('思考过程'), findsOneWidget);
  });

  testWidgets('compact output hides live process details', (tester) async {
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile))
      ..draftCwd = '/mnt/code'
      ..running = true
      ..messages.addAll([
        const ChatMessage(role: 'user', text: '执行任务'),
        const ChatMessage(
          role: 'assistant',
          text: '不应实时展示的中间内容',
          processText: '正在调用工具',
          toolCallCount: 1,
        ),
      ])
      ..streamingMessage = const ChatMessage(
        role: 'assistant',
        text: '尚未完成的流式结果',
      );
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          compactOutput: true,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pump();
    expect(find.textContaining('Pi 正在处理'), findsOneWidget);
    expect(find.text('不应实时展示的中间内容'), findsNothing);
    expect(find.text('尚未完成的流式结果'), findsNothing);
  });

  testWidgets('live working panel shows running tool cards and phase', (
    tester,
  ) async {
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile))
      ..draftCwd = '/mnt/code'
      ..running = true
      ..agentPhase = 'running_tools'
      ..messages.add(const ChatMessage(role: 'user', text: '执行任务'))
      ..liveToolSteps.addAll([
        LiveToolStep(
          name: 'bash',
          toolCallId: 'tc-1',
          arguments: const {'command': 'ls -la'},
          startedAt: DateTime.now().subtract(const Duration(seconds: 3)),
        )..finishedAt = DateTime.now(),
        LiveToolStep(
          name: 'read_file',
          toolCallId: 'tc-2',
          arguments: const {'path': 'lib/main.dart'},
          startedAt: DateTime.now(),
        ),
      ]);
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          compactOutput: true,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pump();
    // Phase line names the currently running tool, web-client style.
    expect(find.textContaining('正在运行工具: read_file'), findsOneWidget);
    // Both tool cards are visible: completed one with duration, running one
    // with a spinner.
    expect(find.text('bash'), findsOneWidget);
    expect(find.text('ls -la'), findsOneWidget);
    expect(find.text('read_file'), findsOneWidget);
    expect(find.text('lib/main.dart'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsWidgets);
  });

  testWidgets('tool card expands to show arguments and result', (tester) async {
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile))
      ..draftCwd = '/mnt/code'
      ..running = false
      ..messages.addAll([
        const ChatMessage(role: 'user', text: '执行任务'),
        const ChatMessage(
          role: 'assistant',
          text: '完成',
          toolCalls: [
            PiToolCall(
              name: 'bash',
              toolCallId: 'tc-1',
              arguments: {'command': 'ls -la'},
            ),
          ],
          toolCallCount: 1,
        ),
      ]);
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('bash'), findsOneWidget);
    expect(find.text('输入参数'), findsNothing);

    await tester.tap(find.text('bash'));
    await tester.pumpAndSettle();
    expect(find.text('输入参数'), findsOneWidget);
    expect(find.textContaining('"command"'), findsOneWidget);
  });

  testWidgets('left swipe opens the function drawer', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile))..draftCwd = '/mnt/code';
    addTearDown(controller.dispose);
    ThemeMode? selectedTheme;
    bool? compactOutput;
    AppLanguagePreference? selectedLanguage;

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          compactOutput: true,
          onThemeModeChanged: (mode) => selectedTheme = mode,
          onCompactOutputChanged: (enabled) => compactOutput = enabled,
          onLanguagePreferenceChanged: (value) => selectedLanguage = value,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.dragFrom(const Offset(389, 420), const Offset(-300, 0));
    await tester.pumpAndSettle();

    expect(find.text('功能与显示'), findsOneWidget);
    expect(find.text('选择工作目录'), findsOneWidget);
    expect(find.text('技能'), findsOneWidget);
    expect(find.text('浅色模式'), findsOneWidget);
    expect(find.text('简洁输出'), findsOneWidget);
    expect(find.text('语言'), findsOneWidget);
    await tester.tap(find.text('浅色模式'));
    await tester.pump();
    expect(selectedTheme, ThemeMode.dark);
    await tester.tap(find.text('简洁输出'));
    await tester.pump();
    expect(compactOutput, isFalse);
    // The drawer is scrollable when it grows beyond the phone screen; drag
    // it up to reveal the 语言 tile before tapping it.
    await tester.drag(
      find.byType(SingleChildScrollView).last,
      const Offset(0, -200),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('语言'));
    await tester.pumpAndSettle();
    expect(find.text('日本語'), findsOneWidget);
    await tester.tap(find.text('日本語'));
    await tester.pumpAndSettle();
    expect(selectedLanguage, AppLanguagePreference.ja);
  });

  testWidgets('shows a jump button away from the latest message', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile))
      ..draftCwd = '/mnt/code'
      ..messages.addAll([
        for (var index = 0; index < 40; index++)
          ChatMessage(role: 'assistant', text: '第 $index 条消息：用于填满聊天列表的测试内容。'),
      ]);
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    final list = find.byType(ListView).first;

    await tester.drag(list, const Offset(0, -10000));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('jump-to-bottom-button')), findsNothing);

    await tester.drag(list, const Offset(0, 500));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('jump-to-bottom-button')), findsOneWidget);

    await tester.tap(find.byKey(const Key('jump-to-bottom-button')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('jump-to-bottom-button')), findsNothing);
    expect(find.text('第 39 条消息：用于填满聊天列表的测试内容。'), findsOneWidget);
  });

  testWidgets('scrollbar thumb uses fine control for short drags', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile))
      ..draftCwd = '/mnt/code'
      ..messages.addAll([
        for (var index = 0; index < 80; index++)
          ChatMessage(role: 'assistant', text: '滚动灵敏度测试消息 $index'),
      ]);
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    final scrollbar = find.byWidgetPredicate(
      (widget) => widget is RawScrollbar,
    );
    final scrollable = tester.state<ScrollableState>(
      find
          .descendant(
            of: find.byType(ListView).first,
            matching: find.byType(Scrollable),
          )
          .first,
    );
    final dynamic scrollbarState = tester.state(scrollbar);
    final dynamic painter = scrollbarState.scrollbarPainter;
    final rect = tester.getRect(scrollbar);
    final standardDistance = painter.getTrackToScroll(20.0) as double;

    final gesture = await tester.startGesture(
      Offset(rect.right - 24, rect.top + 10),
    );
    await tester.pump();
    expect(painter.thickness, 12);
    await gesture.moveBy(const Offset(0, 20));
    await tester.pump();
    expect(scrollable.position.pixels, greaterThan(0));
    expect(scrollable.position.pixels, lessThan(standardDistance * .5));

    await gesture.up();
    await tester.pumpAndSettle();
    expect(painter.thickness, 4);
  });

  testWidgets('directory picker fits a phone and renders API directory maps', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = _DirectoryTestController()
      ..sessions.add(
        PiSession(
          id: 'one',
          cwd: '/mnt/code',
          created: DateTime(2026),
          modified: DateTime(2026),
          messageCount: 1,
          firstMessage: '测试',
        ),
      );
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => FilledButton(
            onPressed: () => showDirectoryPicker(
              context,
              controller: controller,
              initialPath: '/mnt',
            ),
            child: const Text('打开目录'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('打开目录'));
    await tester.pumpAndSettle();

    expect(find.text('选择工作目录'), findsOneWidget);
    expect(find.text('code'), findsWidgets);
    expect(find.text('data'), findsOneWidget);
    expect(find.text('选择 mnt'), findsOneWidget);

    await tester.tap(find.byTooltip('新建文件夹'));
    await tester.pumpAndSettle();
    expect(find.text('新建文件夹'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('new-directory-name')),
      'new-project',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('create-directory-confirm')));
    await tester.pumpAndSettle();
    expect(controller.createdParentPath, '/mnt');
    expect(controller.createdName, 'new-project');
    expect(find.text('选择 new-project'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'iPad landscape shows a permanent session sidebar with capped bubbles',
    (tester) async {
      tester.view.physicalSize = const Size(1366, 1024);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final profile = ServerProfile(
        baseUrl: 'https://example.test',
        username: 'pi',
        password: 'test-only',
      );
      final controller = ChatController(PiApi(profile))
        ..draftCwd = '/mnt/code'
        ..messages.addAll([
          const ChatMessage(
            role: 'user',
            text: '很长的一段用户消息用于确认宽屏下气泡宽度不会撑满整个屏幕，而会保持在一个可读的宽度上限内。',
          ),
          const ChatMessage(
            role: 'assistant',
            text: '这是助手回复，同样应该在宽屏下保持合理宽度，不会拉成整行超宽的长条文本。',
          ),
        ]);
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        MaterialApp(
          home: ChatScreen(
            controller: controller,
            profile: profile,
            onLogout: () async {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Wide layout renders the permanent session pane (embedded) instead of a drawer.
      expect(
        find.ancestor(of: find.text('新建对话'), matching: find.byType(Drawer)),
        findsNothing,
      );
      expect(find.text('新建对话'), findsOneWidget);
      expect(find.text('对话'), findsOneWidget);

      // The conversation column is centered and capped: the composer never
      // stretches beyond 840 logical pixels.
      final composerWidth = tester
          .getSize(find.byKey(const Key('chat-composer')))
          .width;
      expect(composerWidth, lessThanOrEqualTo(840));

      // Message bubbles stay within the capped width (user .82 capped at 760,
      // assistant .94 capped at 840).
      final userWidth = tester
          .getSize(
            find
                .ancestor(
                  of: find.textContaining('很长的一段用户消息'),
                  matching: find.byType(Container),
                )
                .first,
          )
          .width;
      expect(userWidth, lessThanOrEqualTo(760));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('iPad portrait 1024x768 keeps a readable chat column', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1024, 768);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile))
      ..draftCwd = '/mnt/code'
      ..messages.add(const ChatMessage(role: 'assistant', text: 'iPad 竖屏助手消息'));
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          controller: controller,
          profile: profile,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    // 1024 >= 600, so the sidebar is present; chat area stays capped.
    expect(find.text('新建对话'), findsOneWidget);
    final composerWidth = tester
        .getSize(find.byKey(const Key('chat-composer')))
        .width;
    expect(composerWidth, lessThanOrEqualTo(840));
    expect(tester.takeException(), isNull);
  });
}

class _DirectoryTestController extends ChatController {
  _DirectoryTestController()
    : super(
        PiApi(
          ServerProfile(
            baseUrl: 'https://example.test',
            username: 'pi',
            password: 'test-only',
          ),
        ),
      );

  String? createdParentPath;
  String? createdName;

  @override
  Future<DirectoryListing> browseDirectories([String? path]) async {
    return DirectoryListing.fromJson({
      'path': path ?? '/mnt',
      'parentPath': '/',
      'directories': [
        {'name': 'code', 'path': '/mnt/code'},
        {'name': 'data', 'path': '/mnt/data'},
      ],
    });
  }

  @override
  Future<String> createDirectory(String parentPath, String name) async {
    createdParentPath = parentPath;
    createdName = name;
    return '$parentPath/$name';
  }
}

class _NewChatTestController extends ChatController {
  _NewChatTestController(ServerProfile profile) : super(PiApi(profile));

  String? newChatCwd;
  PiModel? newChatModel;

  @override
  Future<void> newChat(String cwd, {PiModel? model}) async {
    newChatCwd = cwd;
    newChatModel = model;
    selectedSession = null;
    activeSessionId = null;
    draftCwd = cwd;
    selectedModel = model;
    messages.clear();
    notifyListeners();
  }
}

class _DeleteTestApi extends PiApi {
  _DeleteTestApi(super.profile);

  String? deletedSessionId;

  @override
  Future<void> deleteSession(String sessionId) async {
    deletedSessionId = sessionId;
  }

  @override
  Future<List<PiSession>> getSessions() async => [];
}

class _CompactTestApi extends PiApi {
  _CompactTestApi(super.profile);

  final Completer<dynamic> compaction = Completer<dynamic>();
  Map<String, dynamic>? command;
  Duration? timeout;

  @override
  Future<dynamic> sendAgentCommand(
    String sessionId,
    Map<String, dynamic> command, {
    Duration timeout = const Duration(seconds: 20),
  }) {
    this.command = command;
    this.timeout = timeout;
    return compaction.future;
  }

  @override
  Future<SessionSnapshot> getSession(String sessionId) async =>
      const SessionSnapshot(
        messages: [ChatMessage(role: 'assistant', text: '压缩后的上下文')],
      );
}

class _SlashTestApi extends PiApi {
  _SlashTestApi(super.profile);

  bool createdSession = false;

  @override
  Future<String> createSession(String cwd, {PiModel? model}) async {
    createdSession = true;
    return 'slash-session';
  }

  @override
  Future<SkillCatalog> getSkills(String cwd) async => const SkillCatalog(
    skills: [
      PiSkill(
        name: 'build',
        description: '构建项目',
        filePath: '/mnt/code/.agents/skills/build/SKILL.md',
        disableModelInvocation: false,
      ),
      PiSkill(
        name: 'review',
        description: '审查项目代码',
        filePath: '/mnt/code/.agents/skills/review/SKILL.md',
        disableModelInvocation: true,
      ),
    ],
    diagnostics: [],
    projectResourcesLoaded: true,
  );

  @override
  Future<List<PiSlashCommand>> getSlashCommands(
    String sessionId,
  ) async => const [
    PiSlashCommand(
      name: 'extension-help',
      description: '扩展命令',
      source: 'extension',
    ),
    PiSlashCommand(
      name: 'prompt-review',
      description: '提示词命令',
      source: 'prompt',
    ),
    PiSlashCommand(
      name: 'skill:review',
      description: '审查项目代码',
      source: 'skill',
    ),
    PiSlashCommand(name: 'skill:build', description: '构建项目', source: 'skill'),
  ];
}
