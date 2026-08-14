import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_web_qt/src/localization.dart';
import 'package:pi_web_qt/src/models.dart';
import 'package:pi_web_qt/src/profile_store.dart';
import 'package:pi_web_qt/src/screens/login_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// In-memory mock of the FlutterSecureStorage platform channel.
class _FakeSecureStorage {
  final Map<String, String> values = {};

  void install() {
    const channel = MethodChannel(
      'plugins.it_nomads.com/flutter_secure_storage',
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          switch (call.method) {
            case 'read':
              return values[call.arguments['key']];
            case 'write':
              values[call.arguments['key']] = call.arguments['value'] as String;
              return null;
            case 'delete':
              values.remove(call.arguments['key']);
              return null;
            case 'readAll':
              return values;
            case 'deleteAll':
              values.clear();
              return null;
            case 'containsKey':
              return values.containsKey(call.arguments['key']);
            default:
              return null;
          }
        });
  }

  void dispose() {
    const channel = MethodChannel(
      'plugins.it_nomads.com/flutter_secure_storage',
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final secure = _FakeSecureStorage();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    secure.values.clear();
    secure.install();
  });

  tearDown(secure.dispose);

  test('saves multiple profiles with per-profile passwords', () async {
    final store = ProfileStore();
    await store.save(
      ServerProfile(
        baseUrl: 'https://a.example',
        username: 'pi',
        password: 'pw-a',
      ),
    );
    await store.save(
      ServerProfile(
        baseUrl: 'https://b.example',
        username: 'pi',
        password: 'pw-b',
      ),
    );

    final all = await store.readAll();
    expect(all.length, 2);
    expect(all.map((p) => p.baseUrl).toSet(), {
      'https://a.example',
      'https://b.example',
    });
    // Passwords are restored from secure storage per profile.
    expect(
      all.where((p) => p.baseUrl == 'https://a.example').first.password,
      'pw-a',
    );
    expect(
      all.where((p) => p.baseUrl == 'https://b.example').first.password,
      'pw-b',
    );
    expect(secure.values.length, 2);
  });

  test('active profile is used by read and can be switched', () async {
    final store = ProfileStore();
    await store.save(
      ServerProfile(
        baseUrl: 'https://a.example',
        username: 'pi',
        password: 'pw-a',
      ),
    );
    await store.save(
      ServerProfile(
        baseUrl: 'https://b.example',
        username: 'pi',
        password: 'pw-b',
      ),
    );

    final firstActive = await store.read();
    expect(firstActive?.baseUrl, 'https://b.example');

    final b = (await store.readAll()).firstWhere(
      (p) => p.baseUrl == 'https://a.example',
    );
    await store.setActive(b.id);

    final switched = await store.read();
    expect(switched?.baseUrl, 'https://a.example');
  });

  test('re-saving the same profile updates it without duplicating', () async {
    final store = ProfileStore();
    await store.save(
      ServerProfile(
        baseUrl: 'https://a.example',
        username: 'pi',
        password: 'pw-a',
      ),
    );
    await store.save(
      ServerProfile(
        baseUrl: 'https://a.example',
        username: 'pi',
        password: 'pw-a2',
      ),
    );

    final all = await store.readAll();
    expect(all.length, 1);
    expect(all.first.password, 'pw-a2');
  });

  test('delete removes the profile and picks the next active', () async {
    final store = ProfileStore();
    final a = await store.save(
      ServerProfile(
        baseUrl: 'https://a.example',
        username: 'pi',
        password: 'pw-a',
      ),
    );
    final b = await store.save(
      ServerProfile(
        baseUrl: 'https://b.example',
        username: 'pi',
        password: 'pw-b',
      ),
    );
    await store.setActive(a.id);

    final nextId = await store.delete(b.id);
    expect(nextId, isNull); // Deleting a non-active profile keeps active one.

    final all = await store.readAll();
    expect(all.length, 1);
    expect(all.first.id, a.id);
    expect(secure.values.containsKey('pi_server_password_${b.id}'), isFalse);

    final nextAfterActive = await store.delete(a.id);
    expect(nextAfterActive, isNull);
    expect(await store.read(), isNull);
  });

  test('logout only clears active; the saved list stays intact', () async {
    final store = ProfileStore();
    await store.save(
      ServerProfile(
        baseUrl: 'https://a.example',
        username: 'pi',
        password: 'pw-a',
      ),
    );
    await store.save(
      ServerProfile(
        baseUrl: 'https://b.example',
        username: 'pi',
        password: 'pw-b',
      ),
    );

    await store.clearActive();

    expect(await store.read(), isNull);
    expect((await store.readAll()).length, 2);
    // Passwords are still stored so the user can switch back without re-typing.
    expect(secure.values.length, 2);
  });

  test('clear wipes every saved profile and password', () async {
    final store = ProfileStore();
    await store.save(
      ServerProfile(
        baseUrl: 'https://a.example',
        username: 'pi',
        password: 'pw-a',
      ),
    );
    await store.save(
      ServerProfile(
        baseUrl: 'https://b.example',
        username: 'pi',
        password: 'pw-b',
      ),
    );

    await store.clear();

    expect(await store.readAll(), isEmpty);
    expect(await store.read(), isNull);
    expect(secure.values, isEmpty);
  });

  test('migrates legacy single-profile keys into the list', () async {
    SharedPreferences.setMockInitialValues({
      'pi_server_base_url': 'https://legacy.example',
      'pi_server_username': 'pi',
    });
    secure.values['pi_server_password'] = 'legacy-pw';

    final store = ProfileStore();
    final profiles = await store.readAll();
    expect(profiles.length, 1);
    expect(profiles.first.baseUrl, 'https://legacy.example');
    expect(profiles.first.password, 'legacy-pw');
    expect(await store.read(), isNotNull);

    // Legacy keys are removed after migration.
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('pi_server_base_url'), isNull);
    expect(prefs.getString('pi_server_username'), isNull);
    expect(secure.values.containsKey('pi_server_password'), isFalse);
  });

  test('profile ids are stable and derived from baseUrl', () {
    final a = ServerProfile(
      baseUrl: 'https://a.example',
      username: 'pi',
      password: '',
    );
    final b = ServerProfile(
      baseUrl: 'https://a.example',
      username: 'pi',
      password: 'x',
    );
    expect(a.id, b.id);
    expect(a.id, isNotEmpty);

    final c = ServerProfile(
      baseUrl: 'https://b.example',
      username: 'pi',
      password: '',
    );
    expect(a.id == c.id, isFalse);
  });

  testWidgets('login screen lists saved servers for quick selection', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final profiles = [
      ServerProfile(
        baseUrl: 'https://saved-a.example',
        username: 'pi',
        password: 'pw-a',
      ),
      ServerProfile(
        baseUrl: 'https://saved-b.example',
        username: 'pi',
        password: 'pw-b',
      ),
    ];
    ServerProfile? submitted;
    await tester.pumpWidget(
      AppLanguageScope(
        language: AppLanguage.zhHans,
        preference: AppLanguagePreference.system,
        onPreferenceChanged: (_) {},
        child: MaterialApp(
          home: LoginScreen(
            onLogin: (profile) async => submitted = profile,
            savedProfiles: profiles,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('已保存的服务器'), findsOneWidget);
    expect(find.text('https://saved-a.example'), findsOneWidget);
    expect(find.text('https://saved-b.example'), findsOneWidget);

    // Tapping a saved server fills the form.
    await tester.tap(find.text('https://saved-a.example'));
    await tester.pump();
    expect(
      tester.widget<TextField>(find.byType(TextField).first).controller!.text,
      'https://saved-a.example',
    );

    // Submit uses the filled profile.
    await tester.tap(find.text('登录'));
    await tester.pumpAndSettle();
    expect(submitted?.baseUrl, 'https://saved-a.example');
    expect(submitted?.password, 'pw-a');
  });

  testWidgets('login screen removes a saved server', (tester) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    String? removedId;
    final profile = ServerProfile(
      baseUrl: 'https://saved-a.example',
      username: 'pi',
      password: 'pw-a',
    );
    await tester.pumpWidget(
      AppLanguageScope(
        language: AppLanguage.zhHans,
        preference: AppLanguagePreference.system,
        onPreferenceChanged: (_) {},
        child: MaterialApp(
          home: LoginScreen(
            onLogin: (_) async {},
            savedProfiles: [profile],
            onDeleteProfile: (id) async => removedId = id,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(Key('delete-saved-server-${profile.id}')));
    await tester.pumpAndSettle();
    expect(removedId, profile.id);
  });
}
