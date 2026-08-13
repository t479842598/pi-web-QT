import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../chat_controller.dart';
import '../localization.dart';
import '../models.dart';
import 'chat_screen.dart';

/// 网页端风格主壳（M1）：
/// 顶部标题栏 + 会话列表主页（按项目分组、搜索、新建）。
/// 点会话进入 [ChatScreen]（其内部自带会话抽屉，可在聊天中切换会话）。
/// 视觉保留玻璃拟态：渐变背景 + 半透明圆角卡片。
class WorkspaceShell extends StatefulWidget {
  const WorkspaceShell({
    super.key,
    required this.controller,
    required this.profile,
    required this.onLogout,
    required this.onSwitchServer,
    required this.themeMode,
    required this.onThemeModeChanged,
    required this.compactOutput,
    required this.onCompactOutputChanged,
    required this.languagePreference,
    required this.onLanguagePreferenceChanged,
    required this.themeSetName,
    required this.onThemeSetChanged,
    required this.accent,
    required this.onAccentChanged,
  });

  final ChatController controller;
  final ServerProfile profile;
  final Future<void> Function() onLogout;
  final Future<void> Function(String id) onSwitchServer;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeModeChanged;
  final bool compactOutput;
  final ValueChanged<bool> onCompactOutputChanged;
  final AppLanguagePreference languagePreference;
  final ValueChanged<AppLanguagePreference> onLanguagePreferenceChanged;
  final String themeSetName;
  final ValueChanged<String> onThemeSetChanged;
  final Color accent;
  final ValueChanged<Color> onAccentChanged;

  @override
  State<WorkspaceShell> createState() => _WorkspaceShellState();
}



class _WorkspaceShellState extends State<WorkspaceShell> {
  String _query = '';
  bool _loading = true;
  /// 置顶会话 id 集合（本地持久化）。
  Set<String> _pinnedIds = {};
  /// 项目备注名称（网页端 project-aliases，按项目根路径映射）。
  Map<String, String> _projectAliases = const {};

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onController);
    _loadPinned();
    _loadAliases();
    _bootstrap();
  }

  Future<void> _loadAliases() async {
    try {
      final aliases = await widget.controller.api.getProjectAliases();
      if (mounted) setState(() => _projectAliases = aliases);
    } catch (_) {
      // 备注加载失败不影响列表
    }
  }

  /// 项目备注名称：优先别名，其次目录名。
  String _aliasOf(String? projectRoot, String cwd) {
    if (projectRoot != null && projectRoot.isNotEmpty) {
      final alias = _projectAliases[projectRoot];
      if (alias != null && alias.isNotEmpty) return alias;
    }
    final alias = _projectAliases[cwd];
    if (alias != null && alias.isNotEmpty) return alias;
    return _projectLabel(cwd);
  }

  Future<void> _loadPinned() async {
    final preferences = await SharedPreferences.getInstance();
    final ids = preferences.getStringList('pi-pinned-sessions') ?? const [];
    if (mounted) setState(() => _pinnedIds = ids.toSet());
  }

  Future<void> _togglePinned(String id) async {
    final next = {..._pinnedIds};
    if (!next.add(id)) next.remove(id);
    setState(() => _pinnedIds = next);
    final preferences = await SharedPreferences.getInstance();
    await preferences.setStringList('pi-pinned-sessions', next.toList());
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onController);
    super.dispose();
  }

  void _onController() {
    if (mounted) setState(() {});
  }

  Future<void> _bootstrap() async {
    try {
      await widget.controller.refreshSessions();
    } catch (_) {
      // 服务不可达时保持空列表，由错误提示兜底
    }
    if (mounted) setState(() => _loading = false);
  }

  /// 会话标题：name 优先，其次首条消息，最后 id 前缀。
  String _titleOf(PiSession s) {
    final name = s.name?.trim();
    if (name != null && name.isNotEmpty) return name;
    final first = s.firstMessage.trim();
    if (first.isNotEmpty) return first.length > 40 ? '${first.substring(0, 40)}…' : first;
    return s.id.length > 8 ? s.id.substring(0, 8) : s.id;
  }

  String _projectLabel(String cwd) {
    final trimmed = cwd.replaceAll(RegExp(r'[/\\]+$'), '');
    final parts = trimmed.split(RegExp(r'[/\\]')).where((e) => e.isNotEmpty).toList();
    return parts.isNotEmpty ? parts.last : cwd;
  }

  /// 项目分组（按 projectRoot ?? cwd），置顶会话在前，组间按最近使用排序。
  List<MapEntry<String, List<PiSession>>> _grouped() {
    final sessions = widget.controller.sessions.where((s) {
      if (_query.isEmpty) return true;
      final q = _query.toLowerCase();
      return _titleOf(s).toLowerCase().contains(q) ||
          s.cwd.toLowerCase().contains(q);
    }).toList()
      ..sort((a, b) {
        final pa = _pinnedIds.contains(a.id) ? 0 : 1;
        final pb = _pinnedIds.contains(b.id) ? 0 : 1;
        return pa != pb ? pa - pb : b.modified.compareTo(a.modified);
      });
    final map = <String, List<PiSession>>{};
    for (final s in sessions) {
      final key = s.projectRoot ?? s.cwd;
      map.putIfAbsent(key, () => []).add(s);
    }
    final entries = map.entries.toList()
      ..sort((a, b) {
        final ma = a.value.firstOrNull?.modified ?? DateTime.fromMillisecondsSinceEpoch(0);
        final mb = b.value.firstOrNull?.modified ?? DateTime.fromMillisecondsSinceEpoch(0);
        return mb.compareTo(ma);
      });
    return entries;
  }

  Future<void> _openSession(PiSession session) async {
    // 立即进入会话页：消息/模型/技能在 ChatScreen 内部异步加载（有 loading
    // 指示器）。不再 await openSession 完成 —— 避免点击后长时间无响应
    // （首屏多个网络请求串行时用户感觉“点不进去”）。
    unawaited(widget.controller.openSession(session).catchError((_) {}));
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ChatScreen(
          controller: widget.controller,
          profile: widget.profile,
          onLogout: widget.onLogout,
          onSwitchServer: widget.onSwitchServer,
          themeMode: widget.themeMode,
          onThemeModeChanged: widget.onThemeModeChanged,
          compactOutput: widget.compactOutput,
          onCompactOutputChanged: widget.onCompactOutputChanged,
          languagePreference: widget.languagePreference,
          onLanguagePreferenceChanged: widget.onLanguagePreferenceChanged,
          themeSetName: widget.themeSetName,
          onThemeSetChanged: widget.onThemeSetChanged,
          accent: widget.accent,
          onAccentChanged: widget.onAccentChanged,
        ),
      ),
    );
    if (mounted) setState(() {});
  }

  Future<void> _newChat(String cwd) async {
    try {
      await widget.controller.newChat(cwd);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('无法新建会话'))),
        );
      }
      return;
    }
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ChatScreen(
          controller: widget.controller,
          profile: widget.profile,
          onLogout: widget.onLogout,
          onSwitchServer: widget.onSwitchServer,
          themeMode: widget.themeMode,
          onThemeModeChanged: widget.onThemeModeChanged,
          compactOutput: widget.compactOutput,
          onCompactOutputChanged: widget.onCompactOutputChanged,
          languagePreference: widget.languagePreference,
          onLanguagePreferenceChanged: widget.onLanguagePreferenceChanged,
          themeSetName: widget.themeSetName,
          onThemeSetChanged: widget.onThemeSetChanged,
          accent: widget.accent,
          onAccentChanged: widget.onAccentChanged,
        ),
      ),
    );
    if (mounted) setState(() {});
  }

  void _toggleTheme() {
    final brightness = Theme.of(context).brightness;
    widget.onThemeModeChanged(brightness == Brightness.dark ? ThemeMode.light : ThemeMode.dark);
  }

  void _showServerMenu() {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.language),
              title: Text(context.tr('切换服务器')),
              subtitle: Text(widget.profile.baseUrl, maxLines: 1, overflow: TextOverflow.ellipsis),
              onTap: () {
                Navigator.of(sheetContext).pop();
                widget.onLogout();
              },
            ),
            ListTile(
              leading: const Icon(Icons.logout),
              title: Text(context.tr('退出登录')),
              onTap: () {
                Navigator.of(sheetContext).pop();
                widget.onLogout();
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final groups = _grouped();

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              scheme.surfaceContainerLowest,
              scheme.surfaceContainerLow,
            ],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              _buildHeader(context, scheme),
              _buildSearch(context),
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : groups.isEmpty
                    ? _buildEmpty(context)
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                        children: [
                          for (final group in groups) ..._buildGroup(context, group),
                        ],
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, ColorScheme scheme) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 8, 8),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Pi Web',
                  style: TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.5,
                    color: scheme.onSurface,
                  ),
                ),
                Text(
                  widget.profile.baseUrl,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: context.tr('切换主题'),
            icon: Icon(
              Theme.of(context).brightness == Brightness.dark
                  ? Icons.light_mode_outlined
                  : Icons.dark_mode_outlined,
            ),
            onPressed: _toggleTheme,
          ),
          IconButton(
            tooltip: context.tr('服务器'),
            icon: const Icon(Icons.swap_horiz),
            onPressed: _showServerMenu,
          ),
        ],
      ),
    );
  }

  Widget _buildSearch(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: TextField(
        onChanged: (v) => setState(() => _query = v.trim()),
        decoration: InputDecoration(
          hintText: context.tr('搜索会话'),
          prefixIcon: const Icon(Icons.search, size: 20),
          isDense: true,
          filled: true,
          fillColor: Theme.of(context).colorScheme.surfaceContainerHigh.withValues(alpha: .6),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  List<Widget> _buildGroup(BuildContext context, MapEntry<String, List<PiSession>> group) {
    final scheme = Theme.of(context).colorScheme;
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(8, 16, 8, 6),
        child: Row(
          children: [
            Expanded(
              child: Text(
                _aliasOf(group.key, group.key),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              tooltip: context.tr('新建会话'),
              icon: const Icon(Icons.add, size: 18),
              onPressed: () => _newChat(group.key),
            ),
          ],
        ),
      ),
      ...group.value.map((s) => _buildSessionCard(context, s)),
    ];
  }

  Widget _buildSessionCard(BuildContext context, PiSession s) {
    final scheme = Theme.of(context).colorScheme;
    final pinned = _pinnedIds.contains(s.id);
    final alias = _aliasOf(s.projectRoot, s.cwd);
    final branch = s.worktreeBranch;
    final isFork = s.parentSession != null && s.parentSession!.isNotEmpty;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: scheme.surfaceContainerHigh.withValues(alpha: .55),
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => _openSession(s),
          onLongPress: () => _showSessionActions(context, s),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        widget.accent,
                        widget.accent.withValues(alpha: .65),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Center(
                    child: s.running
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Icon(
                            s.messageCount > 0
                                ? Icons.forum_outlined
                                : Icons.edit_outlined,
                            size: 16,
                            color: Colors.white,
                          ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Line 1: 标题 + 置顶标记
                      Row(
                        children: [
                          if (pinned) ...[
                            Icon(
                              Icons.push_pin,
                              size: 11,
                              color: scheme.onSurfaceVariant,
                            ),
                            const SizedBox(width: 3),
                          ],
                          Expanded(
                            child: Text(
                              _titleOf(s),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: scheme.onSurface,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      // Line 2: 备注名称 · 相对时间 · 消息数 · 分支 · fork
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              alias,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 10.5,
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _relativeTime(s.modified),
                            style: TextStyle(
                              fontSize: 10,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            context.tr('{count} 条消息', {
                              'count': s.messageCount,
                            }),
                            style: TextStyle(
                              fontSize: 10,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                          if (branch != null && branch.isNotEmpty) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 5,
                                vertical: 1,
                              ),
                              decoration: BoxDecoration(
                                color: scheme.surfaceContainerHighest
                                    .withValues(alpha: .7),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.alt_route_rounded,
                                    size: 9,
                                    color: scheme.onSurfaceVariant,
                                  ),
                                  const SizedBox(width: 3),
                                  ConstrainedBox(
                                    constraints: const BoxConstraints(
                                      maxWidth: 80,
                                    ),
                                    child: Text(
                                      branch,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 9.5,
                                        fontFamily: 'monospace',
                                        color: scheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                          if (isFork) ...[
                            const SizedBox(width: 6),
                            Icon(
                              Icons.call_split_rounded,
                              size: 11,
                              color: scheme.outline,
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// 长按会话卡片：重命名 / 置顶切换 / 删除。
  Future<void> _showSessionActions(BuildContext context, PiSession s) async {
    final scheme = Theme.of(context).colorScheme;
    final pinned = _pinnedIds.contains(s.id);
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(
                _titleOf(s),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
              ),
              subtitle: Text(s.cwd, maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.drive_file_rename_outline),
              title: Text(context.tr('重命名')),
              onTap: () => Navigator.of(sheetContext).pop('rename'),
            ),
            ListTile(
              leading: Icon(pinned ? Icons.push_pin_outlined : Icons.push_pin),
              title: Text(context.tr(pinned ? '取消置顶' : '置顶')),
              onTap: () => Navigator.of(sheetContext).pop('pin'),
            ),
            ListTile(
              leading: Icon(Icons.delete_outline, color: scheme.error),
              title: Text(context.tr('删除'), style: TextStyle(color: scheme.error)),
              onTap: () => Navigator.of(sheetContext).pop('delete'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    switch (action) {
      case 'rename':
        await _renameSession(context, s);
      case 'pin':
        await _togglePinned(s.id);
      case 'delete':
        await _deleteSession(context, s);
    }
  }

  Future<void> _renameSession(BuildContext context, PiSession s) async {
    final controller = TextEditingController(text: s.name ?? '');
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(context.tr('重命名')),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 80,
          decoration: InputDecoration(hintText: context.tr('请输入新名称')),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(context.tr('取消')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()),
            child: Text(context.tr('确定')),
          ),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.isEmpty || !mounted) return;
    try {
      await widget.controller.renameSession(s.id, name);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('重命名失败'))),
        );
      }
    }
  }

  Future<void> _deleteSession(BuildContext context, PiSession s) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(context.tr('删除')),
        content: Text(context.tr('确定要删除这个会话吗？此操作不可撤销。')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(context.tr('取消')),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(context.tr('删除')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await widget.controller.deleteSession(s);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('删除失败'))),
        );
      }
    }
  }

  Widget _buildEmpty(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.forum_outlined, size: 44, color: scheme.onSurfaceVariant),
          const SizedBox(height: 12),
          Text(
            _query.isEmpty ? context.tr('暂无会话') : context.tr('没有匹配的会话'),
            style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  String _relativeTime(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inMinutes < 1) return context.tr('刚刚');
    if (diff.inHours < 1) return '${diff.inMinutes} ${context.tr('分钟前')}';
    if (diff.inDays < 1) return '${diff.inHours} ${context.tr('小时前')}';
    if (diff.inDays < 30) return '${diff.inDays} ${context.tr('天前')}';
    return '${time.year}-${time.month.toString().padLeft(2, '0')}-${time.day.toString().padLeft(2, '0')}';
  }
}
