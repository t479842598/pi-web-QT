import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pi_web_qt/src/chat_controller.dart';
import 'package:pi_web_qt/src/localization.dart';
import 'package:pi_web_qt/src/models.dart';
import 'package:pi_web_qt/src/pi_api.dart';
import 'package:pi_web_qt/src/screens/workspace_shell.dart';

Future<void> pumpN(WidgetTester tester, int n) async {
  for (var i = 0; i < n; i++) {
    await tester.pump(const Duration(milliseconds: 300));
  }
}

void main() {
  testWidgets('drawer home button returns to home', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile));
    controller.sessions.add(
      PiSession(
        id: 's1',
        cwd: '/mnt/code',
        created: DateTime.now(),
        modified: DateTime.now(),
        messageCount: 3,
        firstMessage: 'hello',
        name: '会话一',
      ),
    );
    addTearDown(controller.dispose);

    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: WorkspaceShell(
          controller: controller,
          profile: profile,
          onLogout: () async {},
          onSwitchServer: (_) async {},
          themeMode: ThemeMode.light,
          onThemeModeChanged: (_) {},
          compactOutput: true,
          onCompactOutputChanged: (_) {},
          languagePreference: AppLanguagePreference.zhHans,
          onLanguagePreferenceChanged: (_) {},
          themeSetName: '',
          onThemeSetChanged: (_) {},
          accent: Colors.teal,
          onAccentChanged: (_) {},
        ),
      ),
    );
    await pumpN(tester, 6);
    final texts = tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').where((t) => t.isNotEmpty).take(12).toList();
    debugPrint('>> home page texts: $texts');
    expect(find.text('项目'), findsOneWidget);

    // 进项目页
    await tester.tap(find.text('code'));
    await pumpN(tester, 4);
    debugPrint('>> project page: 会话一=${find.text('会话一').evaluate().length}');
    expect(find.text('会话一'), findsOneWidget);

    // 进对话页
    await tester.tap(find.text('会话一'));
    await pumpN(tester, 6);
    debugPrint('>> chat page: menu_rounded=${find.byIcon(Icons.menu_rounded).evaluate().length}');
    expect(find.byIcon(Icons.menu_rounded), findsOneWidget);

    // 打开抽屉
    await tester.tap(find.byIcon(Icons.menu_rounded));
    await pumpN(tester, 4);
    final btn = find.byKey(const Key('drawer-home-button'));
    debugPrint('>> drawer home button found=${btn.evaluate().length}');
    expect(btn, findsWidgets);

    // 点击回首页
    await tester.tap(btn.first);
    await pumpN(tester, 6);
    debugPrint(
      '>> after home click: 项目=${find.text('项目').evaluate().length} menu=${find.byIcon(Icons.menu_rounded).evaluate().length}',
    );
    expect(find.text('项目'), findsOneWidget);
    expect(find.byIcon(Icons.menu_rounded), findsNothing);
  });
}
