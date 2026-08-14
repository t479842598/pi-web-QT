import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'apple_theme.dart';
import 'font_scale.dart';
import 'chat_controller.dart';
import 'localization.dart';
import 'models.dart';
import 'pi_api.dart';
import 'profile_store.dart';
import 'screens/login_screen.dart';
import 'screens/workspace_shell.dart';

class PiMobileApp extends StatefulWidget {
  const PiMobileApp({super.key});

  @override
  State<PiMobileApp> createState() => _PiMobileAppState();
}

class _PiMobileAppState extends State<PiMobileApp> with WidgetsBindingObserver {
  final _store = ProfileStore();
  final _navigatorKey = GlobalKey<NavigatorState>();
  ServerProfile? _profile;
  ChatController? _controller;
  bool _restoring = true;
  ThemeMode _themeMode = ThemeMode.system;
  bool _compactOutput = true;
  AppLanguagePreference _languagePreference = AppLanguagePreference.system;

  /// User-selectable accent color (MonkeyCode-style). Persisted as hex.
  Color _accent = AppleColors.accent;

  /// Selected web theme set name ('' = built-in default). Persisted locally.
  String _themeSetName = '';

  /// Resolved CSS vars for the selected theme set (cached per mode).
  Map<String, String> _themeVarsLight = const {};
  Map<String, String> _themeVarsDark = const {};

  /// Cached ThemeData（避免每次 build 重建导致切换主题卡顿）。
  ThemeData? _cachedLightTheme;
  ThemeData? _cachedDarkTheme;
  Color _cachedLightAccent = AppleColors.accent;
  Color _cachedDarkAccent = AppleColors.accent;
  Map<String, String> _cachedLightVars = const {};
  Map<String, String> _cachedDarkVars = const {};

  /// 主题缓存键变化时重建 ThemeData；否则复用缓存。
  ThemeData _lightTheme() {
    if (_cachedLightTheme == null ||
        _cachedLightAccent != _accent ||
        _cachedLightVars != _themeVarsLight) {
      _cachedLightTheme = _themeVarsLight.isEmpty
          ? buildAppleTheme(Brightness.light, accent: _accent)
          : buildThemeFromVars(_themeVarsLight, dark: false);
      _cachedLightAccent = _accent;
      _cachedLightVars = _themeVarsLight;
    }
    return _cachedLightTheme!;
  }

  ThemeData _darkTheme() {
    if (_cachedDarkTheme == null ||
        _cachedDarkAccent != _accent ||
        _cachedDarkVars != _themeVarsDark) {
      _cachedDarkTheme = _themeVarsDark.isEmpty
          ? buildAppleTheme(Brightness.dark, accent: _accent)
          : buildThemeFromVars(_themeVarsDark, dark: true);
      _cachedDarkAccent = _accent;
      _cachedDarkVars = _themeVarsDark;
    }
    return _cachedDarkTheme!;
  }

  /// Guards against stale async theme-var loads (quick theme A→B switching).
  int _themeLoadGeneration = 0;

  AppLanguage get _language => resolveAppLanguage(
    _languagePreference,
    WidgetsBinding.instance.platformDispatcher.locales,
  );

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _restoreDisplayPreferences();
    loadFontScale();
    _restore();
  }

  Future<void> _restoreDisplayPreferences() async {
    final preferences = await SharedPreferences.getInstance();
    if (!mounted) return;
    final savedTheme = preferences.getString('pi-theme-mode');
    setState(() {
      _themeMode = switch (savedTheme) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      };
      _compactOutput = preferences.getBool('pi-compact-output') ?? true;
      _languagePreference = AppLanguagePreference.values.firstWhere(
        (value) => value.name == preferences.getString('pi-language'),
        orElse: () => AppLanguagePreference.system,
      );
      _themeSetName = preferences.getString('pi-theme-set') ?? '';
      _accent = colorFromHex(preferences.getString('pi-accent')) ??
          AppleColors.accent;
    });
    // The controller may be created later (concurrent _restore); the restored
    // language is re-applied when the controller is handed over.
    _controller?.setLanguage(_language);
  }

  Future<void> _setThemeMode(ThemeMode mode) async {
    setState(() => _themeMode = mode);
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString('pi-theme-mode', mode.name);
  }

  /// Switches the user-selectable accent color and persists it.
  Future<void> _setAccent(Color color) async {
    if (!mounted) return;
    setState(() => _accent = color);
    final hex = '#${color.toARGB32().toRadixString(16).padLeft(8, '0').substring(2)}';
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString('pi-accent', hex);
  }

  /// Switches the web theme set ('' = built-in default). Resolves both
  /// variants and caches the CSS vars so the light/dark themes update.
  Future<void> _setThemeSet(String name) async {
    final generation = ++_themeLoadGeneration;
    setState(() {
      _themeSetName = name;
      _themeVarsLight = const {};
      _themeVarsDark = const {};
    });
    final controller = _controller;
    if (name.isNotEmpty && controller != null) {
      final light = await controller.api.getThemeVars(name, dark: false);
      final dark = await controller.api.getThemeVars(name, dark: true);
      // A newer selection (or server switch) superseded this load — ignore.
      if (!mounted || generation != _themeLoadGeneration) return;
      setState(() {
        _themeVarsLight = light ?? const {};
        _themeVarsDark = dark ?? const {};
      });
    }
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString('pi-theme-set', name);
  }

  Future<void> _setCompactOutput(bool enabled) async {
    setState(() => _compactOutput = enabled);
    final preferences = await SharedPreferences.getInstance();
    await preferences.setBool('pi-compact-output', enabled);
  }

  Future<void> _setLanguagePreference(AppLanguagePreference preference) async {
    setState(() => _languagePreference = preference);
    _controller?.setLanguage(_language);
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString('pi-language', preference.name);
  }

  @override
  void didChangeLocales(List<Locale>? locales) {
    if (_languagePreference != AppLanguagePreference.system || !mounted) {
      return;
    }
    setState(() {});
    _controller?.setLanguage(_language);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed) {
      _controller?.onAppResumed();
    }
  }

  Future<void> _restore() async {
    final profile = await _store.read();
    ChatController? controller;
    if (profile != null) {
      controller = ChatController(PiApi(profile, language: _language));
      try {
        await controller.initialize();
      } catch (_) {
        controller.dispose();
        controller = null;
      }
    }
    if (!mounted) {
      controller?.dispose();
      return;
    }
    setState(() {
      _profile = profile;
      _controller = controller;
      _restoring = false;
    });
    // Apply the restored language preference to the fresh controller in case
    // _restoreDisplayPreferences completed before it was created.
    controller?.setLanguage(_language);
    _loadThemeVars(controller);
  }

  /// Loads and caches the selected theme set's light/dark CSS vars.
  Future<void> _loadThemeVars(ChatController? controller) async {
    final name = _themeSetName;
    if (name.isEmpty || controller == null) return;
    final generation = ++_themeLoadGeneration;
    final light = await controller.api.getThemeVars(name, dark: false);
    final dark = await controller.api.getThemeVars(name, dark: true);
    if (!mounted || generation != _themeLoadGeneration) return;
    setState(() {
      _themeVarsLight = light ?? const {};
      _themeVarsDark = dark ?? const {};
    });
  }

  Future<void> _login(ServerProfile profile) async {
    final controller = ChatController(PiApi(profile, language: _language));
    try {
      await controller.initialize();
    } catch (_) {
      controller.dispose();
      rethrow;
    }
    final saved = await _store.save(profile);
    if (!mounted) {
      controller.dispose();
      return;
    }
    _controller?.dispose();
    setState(() {
      _profile = saved;
      _controller = controller;
    });
    controller.setLanguage(_language);
    _loadThemeVars(controller);
  }

  /// Disconnects the current session only; the saved server list stays intact
  /// so the user can switch back quickly.
  Future<void> _logout() async {
    await _store.clearActive();
    _controller?.dispose();
    if (!mounted) return;
    setState(() {
      _profile = null;
      _controller = null;
    });
  }

  /// Switches to another saved server and connects to it.
  Future<void> _switchServer(String id) async {
    final profiles = await _store.readAll();
    final target = profiles.where((profile) => profile.id == id).firstOrNull;
    if (target == null || !mounted) return;
    final controller = ChatController(PiApi(target, language: _language));
    try {
      await controller.initialize();
    } catch (_) {
      controller.dispose();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(_errorTextForSwitch())));
      return;
    }
    await _store.setActive(id);
    _controller?.dispose();
    setState(() {
      _profile = target;
      _controller = controller;
    });
    controller.setLanguage(_language);
    _loadThemeVars(controller);
  }

  String _errorTextForSwitch() =>
      AppLocalizations.text(_language, '无法连接到该服务器，请检查地址和网络');

  /// Removes a saved server entry (and its stored password). When the removed
  /// profile was active, returns to the login screen.
  Future<void> _removeProfile(String id) async {
    try {
      await _store.delete(id);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorTextForSwitch())));
      }
      return;
    }
    if (!mounted) return;
    if (_profile?.id == id) {
      _controller?.dispose();
      setState(() {
        _profile = null;
        _controller = null;
      });
    } else {
      setState(() {});
    }
  }

  Future<List<ServerProfile>> _savedProfiles() => _store.readAll();

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final language = _language;
    return MaterialApp(
      navigatorKey: _navigatorKey,
      debugShowCheckedModeBanner: false,
      title: 'pi-web-qt',
      locale: language.locale,
      supportedLocales: AppLanguage.values.map((value) => value.locale),
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      themeMode: _themeMode,
      theme: _lightTheme(),
      darkTheme: _darkTheme(),
      builder: (context, child) => ValueListenableBuilder<double>(
        valueListenable: fontScaleNotifier,
        builder: (context, fontScale, _) => MediaQuery(
          // 全局字体缩放（textScaler 应用于所有页面）
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(fontScale),
          ),
          child: AppLanguageScope(
            language: language,
            preference: _languagePreference,
            onPreferenceChanged: _setLanguagePreference,
            child: child ?? const SizedBox.shrink(),
          ),
        ),
      ),
      home: _restoring
          ? const _Splash()
          : _profile == null
          ? _LoginWithSavedServers(
              onLogin: _login,
              onToggleTheme: _toggleTheme,
              loadProfiles: _savedProfiles,
              onDeleteProfile: _removeProfile,
            )
          : _controller == null
          ? _LoginWithSavedServers(
              initialProfile: _profile,
              onLogin: _login,
              onToggleTheme: _toggleTheme,
              loadProfiles: _savedProfiles,
              onDeleteProfile: _removeProfile,
            )
          : WorkspaceShell(
              controller: _controller!,
              profile: _profile!,
              onLogout: _logout,
              onSwitchServer: _switchServer,
              themeMode: _themeMode,
              onThemeModeChanged: _setThemeMode,
              compactOutput: _compactOutput,
              onCompactOutputChanged: _setCompactOutput,
              languagePreference: _languagePreference,
              onLanguagePreferenceChanged: _setLanguagePreference,
              themeSetName: _themeSetName,
              onThemeSetChanged: _setThemeSet,
              accent: _accent,
              onAccentChanged: _setAccent,
            ),
    );
  }

  /// Central `+` button — opens the new-task bottom sheet.
  void _toggleTheme() {
    final brightness = _navigatorKey.currentContext == null
        ? WidgetsBinding.instance.platformDispatcher.platformBrightness
        : Theme.of(_navigatorKey.currentContext!).brightness;
    _setThemeMode(
      brightness == Brightness.dark ? ThemeMode.light : ThemeMode.dark,
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}

class _LoginWithSavedServers extends StatelessWidget {
  const _LoginWithSavedServers({
    required this.onLogin,
    required this.onToggleTheme,
    required this.loadProfiles,
    required this.onDeleteProfile,
    this.initialProfile,
  });

  final ServerProfile? initialProfile;
  final Future<void> Function(ServerProfile profile) onLogin;
  final VoidCallback? onToggleTheme;
  final Future<List<ServerProfile>> Function() loadProfiles;
  final Future<void> Function(String id) onDeleteProfile;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<ServerProfile>>(
      future: loadProfiles(),
      builder: (context, snapshot) => LoginScreen(
        initialProfile: initialProfile,
        onLogin: onLogin,
        onToggleTheme: onToggleTheme,
        savedProfiles: snapshot.data ?? const [],
        onDeleteProfile: onDeleteProfile,
      ),
    );
  }
}
