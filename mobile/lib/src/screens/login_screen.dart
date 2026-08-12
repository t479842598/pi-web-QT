import 'package:flutter/material.dart';

import '../apple_theme.dart';
import '../localization.dart';
import '../models.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.onLogin,
    this.initialProfile,
    this.onToggleTheme,
    this.savedProfiles = const [],
    this.onDeleteProfile,
  });

  final ServerProfile? initialProfile;
  final Future<void> Function(ServerProfile profile) onLogin;
  final VoidCallback? onToggleTheme;
  final List<ServerProfile> savedProfiles;
  final Future<void> Function(String id)? onDeleteProfile;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  late final TextEditingController _server;
  late final TextEditingController _password;
  bool _obscure = true;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _server = TextEditingController(text: widget.initialProfile?.baseUrl ?? '');
    _password = TextEditingController(
      text: widget.initialProfile?.password ?? '',
    );
  }

  @override
  void dispose() {
    _server.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final url = normalizeServerUrl(
        _server.text,
        language: context.appLanguage,
      );
      await widget.onLogin(
        ServerProfile(baseUrl: url, username: 'pi', password: _password.text),
      );
    } catch (e) {
      if (!mounted) return;
      setState(
        () => _error = e
            .toString()
            .replaceFirst('FormatException: ', '')
            .replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        actions: [
          if (widget.onToggleTheme != null)
            IconButton(
              onPressed: widget.onToggleTheme,
              tooltip: Theme.of(context).brightness == Brightness.dark
                  ? context.tr('切换浅色模式')
                  : context.tr('切换深色模式'),
              icon: Icon(
                Theme.of(context).brightness == Brightness.dark
                    ? Icons.light_mode_outlined
                    : Icons.dark_mode_outlined,
              ),
            ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(22, 36, 22, 28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Align(child: _PiMark()),
                    const SizedBox(height: 26),
                    Text(
                      context.tr('连接你的 Pi'),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      context.tr('输入域名或 IP 地址，账号固定为 pi。服务器未启用认证时，密码可留空'),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 30),
                    Container(
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        borderRadius: BorderRadius.circular(AppleRadius.panel),
                        boxShadow: AppleShadows.panel,
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: Column(
                        children: [
                          _LoginField(
                            controller: _server,
                            label: context.tr('服务器地址'),
                            hint: context.tr('域名或 IP 地址'),
                            icon: Icons.dns_outlined,
                            keyboardType: TextInputType.url,
                            textInputAction: TextInputAction.next,
                          ),
                          const Divider(indent: 54),
                          _LoginField(
                            controller: _password,
                            label: context.tr('密码（可选）'),
                            icon: Icons.lock_outline,
                            obscureText: _obscure,
                            textInputAction: TextInputAction.done,
                            autofillHints: const [AutofillHints.password],
                            onSubmitted: (_) => _submit(),
                            suffix: IconButton(
                              onPressed: () =>
                                  setState(() => _obscure = !_obscure),
                              tooltip: _obscure
                                  ? context.tr('显示密码')
                                  : context.tr('隐藏密码'),
                              icon: Icon(
                                _obscure
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      Text(
                        _error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ],
                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: _loading ? null : _submit,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(54),
                        shape: const StadiumBorder(),
                      ),
                      child: _loading
                          ? const SizedBox.square(
                              dimension: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(
                              context.tr('登录'),
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                    ),
                    const SizedBox(height: 18),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.shield_outlined,
                          size: 18,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            context.tr('密码会加密保存在本机。通过公网或域名访问时，请务必使用 HTTPS。'),
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.onSurfaceVariant,
                                ),
                          ),
                        ),
                      ],
                    ),
                    if (widget.savedProfiles.isNotEmpty) ...[
                      const SizedBox(height: 26),
                      _SavedServers(
                        profiles: widget.savedProfiles,
                        onSelect: (profile) {
                          _server.text = profile.baseUrl;
                          _password.text = profile.password;
                          setState(() {});
                        },
                        onDelete: widget.onDeleteProfile,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SavedServers extends StatelessWidget {
  const _SavedServers({
    required this.profiles,
    required this.onSelect,
    required this.onDelete,
  });

  final List<ServerProfile> profiles;
  final ValueChanged<ServerProfile> onSelect;
  final Future<void> Function(String id)? onDelete;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          context.tr('已保存的服务器'),
          style: Theme.of(
            context,
          ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 10),
        Container(
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(AppleRadius.panel),
            boxShadow: AppleShadows.panel,
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var index = 0; index < profiles.length; index++) ...[
                if (index > 0) const Divider(indent: 54),
                Material(
                  color: Colors.transparent,
                  child: ListTile(
                    dense: true,
                    leading: Icon(
                      Icons.dns_outlined,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                    title: Text(
                      profiles[index].baseUrl,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(profiles[index].username),
                    trailing: onDelete == null
                        ? null
                        : IconButton(
                            key: Key(
                              'delete-saved-server-${profiles[index].id}',
                            ),
                            tooltip: context.tr('移除'),
                            onPressed: () => onDelete!(profiles[index].id),
                            icon: const Icon(Icons.delete_outline, size: 20),
                          ),
                    onTap: () => onSelect(profiles[index]),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _PiMark extends StatelessWidget {
  const _PiMark();

  @override
  Widget build(BuildContext context) => Container(
    width: 72,
    height: 72,
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xff0a84ff), Color(0xff5e5ce6)],
      ),
      borderRadius: BorderRadius.circular(AppleRadius.hero),
      boxShadow: const [
        BoxShadow(
          color: Color(0x3d0071e3),
          blurRadius: 34,
          offset: Offset(0, 14),
        ),
      ],
    ),
    child: const Icon(Icons.terminal_rounded, color: Colors.white, size: 34),
  );
}

class _LoginField extends StatelessWidget {
  const _LoginField({
    required this.controller,
    required this.label,
    required this.icon,
    required this.textInputAction,
    this.hint,
    this.keyboardType,
    this.autofillHints,
    this.obscureText = false,
    this.onSubmitted,
    this.suffix,
  });

  final TextEditingController controller;
  final String label;
  final String? hint;
  final IconData icon;
  final TextInputAction textInputAction;
  final TextInputType? keyboardType;
  final Iterable<String>? autofillHints;
  final bool obscureText;
  final ValueChanged<String>? onSubmitted;
  final Widget? suffix;

  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    keyboardType: keyboardType,
    textInputAction: textInputAction,
    autofillHints: autofillHints,
    obscureText: obscureText,
    autocorrect: false,
    onSubmitted: onSubmitted,
    decoration: InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: Icon(icon, size: 21),
      suffixIcon: suffix,
      filled: false,
      border: InputBorder.none,
      enabledBorder: InputBorder.none,
      focusedBorder: InputBorder.none,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
  );
}
