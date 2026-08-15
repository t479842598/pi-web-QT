import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../chat_controller.dart';
import '../localization.dart';
import '../models.dart';
import 'chat_screen.dart';
import 'directory_picker.dart';

/// 网页端风格主壳（M1）：
/// 顶部标题栏 + 项目下拉选择 + 会话列表主页（按 置顶/今天/昨天/更早 手风琴
/// 分组，参考网页端 SessionSidebar 的 AccordionGroup 样式）。
/// 点会话进入 [ChatScreen]（其内部自带会话抽屉，可在聊天中切换会话）。
/// 视觉保留玻璃拟态：渐变背景 + 半透明圆角卡片。
/// 会话行支持：置顶图标（点击即在置顶模块显示/隐藏）、任务面板模块颜色
/// 标识（会话关联任务时按任务看板列颜色显示圆点）、消息数量。
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

/// 手风琴分组 key：置顶 / 今天 / 昨天 / 更早（与网页端 GroupKey 对齐）。
enum _GroupKey { pinned, today, yesterday, older }

class _SessionGroup {
  const _SessionGroup(this.key, this.title, this.sessions);

  final _GroupKey key;
  final String title;
  final List<PiSession> sessions;
}

class _WorkspaceShellState extends State<WorkspaceShell> {
  static const _pinnedStorageKey = 'pi-pinned-sessions';
  static const _selectedProjectKey = 'pi-selected-project';

  String _query = '';
  bool _loading = true;
  /// 本地置顶会话 id（兼容历史本地置顶 + 服务端置顶并集）。
  Set<String> _localPinnedIds = {};
  /// 项目备注名称（网页端 project-aliases，按项目根路径映射）。
  Map<String, String> _projectAliases = const {};
  /// 当前选中的项目（projectRoot 路径），持久化在本地。
  String? _selectedProject;
  /// true = 首页（所有项目目录页）；false = 选中项目的会话列表页。
  bool _atHome = true;
  /// 对话页抽屉点了「回首页」：pop 后据此回到首页（不依赖 pop 返回值）。
  bool _homeRequested = false;
  /// 首页项目列表折叠状态（默认展开）。
  bool _homeExpanded = true;
  /// 收起的手风琴分组（默认“更早”收起，与网页端一致）。
  final Set<_GroupKey> _collapsedGroups = {_GroupKey.older};

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onController);
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

  /// 卡片底部路径：有备注时显示真实目录名（原来的名称），没备注显示完整路径。
  String _pathLabel(String? projectRoot, String cwd) {
    final root = projectRoot ?? cwd;
    final hasAlias = _projectAliases[projectRoot]?.isNotEmpty == true ||
        _projectAliases[cwd]?.isNotEmpty == true;
    if (hasAlias) return _projectLabel(root);
    return root;
  }

  Future<void> _loadPinned() async {
    final preferences = await SharedPreferences.getInstance();
    final stored =
        preferences.getStringList(_pinnedStorageKey) ?? const <String>[];
    // 采纳服务端置顶（网页端置顶的会话在这里同样置顶）。
    final serverPinned = widget.controller.sessions
        .where((s) => s.pinned)
        .map((s) => s.id)
        .toSet();
    final merged = <String>{...stored, ...serverPinned};
    if (merged.length != stored.length) {
      await preferences.setStringList(_pinnedStorageKey, merged.toList());
    }
    if (mounted) setState(() => _localPinnedIds = merged);
  }

  /// 会话是否置顶：服务端 pinned 或本地历史置顶集合命中。
  bool _isPinned(PiSession s) =>
      s.pinned || _localPinnedIds.contains(s.id);

  Future<void> _persistPinned() async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setStringList(_pinnedStorageKey, _localPinnedIds.toList());
  }

  /// 置顶/取消置顶：本地集合立即翻转（置顶模块即时更新），随后乐观同步服务端。
  Future<void> _togglePinned(PiSession s) async {
    final next = !_isPinned(s);
    final ids = {..._localPinnedIds};
    if (next) {
      ids.add(s.id);
    } else {
      ids.remove(s.id);
    }
    setState(() => _localPinnedIds = ids);
    await _persistPinned();
    await widget.controller.setSessionPinned(s.id, next).catchError((_) {});
  }

  Future<void> _persistProject() async {
    final project = _selectedProject;
    if (project == null || project.isEmpty) return;
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_selectedProjectKey, project);
  }

  Future<void> _loadProject() async {
    final preferences = await SharedPreferences.getInstance();
    final saved = preferences.getString(_selectedProjectKey);
    if (saved != null && saved.isNotEmpty && mounted) {
      setState(() => _selectedProject = saved);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onController);
    super.dispose();
  }

  void _onController() {
    if (!mounted) return;
    final roots = _projectRoots;
    final selected = _selectedProject;
    if (selected == null ||
        (roots.isNotEmpty && !roots.contains(selected))) {
      if (_atHome) {
        _selectedProject = roots.isNotEmpty ? roots.first : null;
      } else if (selected == null) {
        // 项目页但选中项目丢失（全部会话被删）→ 回首页
        _atHome = true;
      } else if (roots.isNotEmpty) {
        _selectedProject = roots.first;
      }
    }
    setState(() {});
  }

  /// 点击首页项目卡片：进入该项目的会话列表页。
  void _enterProject(String project) {
    setState(() {
      _selectedProject = project;
      _atHome = false;
      _query = ''; // 进入新项目不沿用上一个项目的搜索词
    });
    unawaited(_persistProject());
  }

  /// 回首页：返回所有项目目录页。
  void _goHome() {
    setState(() => _atHome = true);
  }

  Future<void> _bootstrap() async {
    try {
      await widget.controller.refreshSessions();
    } catch (_) {
      // 服务不可达时保持空列表，由错误提示兜底
    }
    // 任务列表用于会话行的任务模块颜色标识（失败不影响列表）。
    unawaited(widget.controller.refreshTasks().catchError((_) {}));
    await _loadProject();
    await _loadPinned();
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _refreshAll() async {
    try {
      await widget.controller.refreshSessions();
    } catch (_) {
      // 下拉刷新失败保持原列表
    }
    await _loadPinned();
    await widget.controller.refreshTasks().catchError((_) {});
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

  /// 全部项目（projectRoot ?? cwd 去重），按最近会话活动排序（与网页端
  /// getRecentProjects 对齐）。
  List<String> get _projectRoots {
    final latest = <String, DateTime>{};
    for (final s in widget.controller.sessions) {
      final key = s.projectRoot?.isNotEmpty == true ? s.projectRoot! : s.cwd;
      if (key.isEmpty) continue;
      final prev = latest[key];
      if (prev == null || s.modified.isAfter(prev)) latest[key] = s.modified;
    }
    final entries = latest.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    return [for (final e in entries) e.key];
  }

  /// 某项目的全部会话（不应用搜索），按最近修改倒序。
  List<PiSession> _projectSessions(String project) {
    return widget.controller.sessions
        .where(
          (s) => (s.projectRoot?.isNotEmpty == true ? s.projectRoot! : s.cwd) == project,
        )
        .toList()
      ..sort((a, b) => b.modified.compareTo(a.modified));
  }

  /// 本地时区 YYYY-MM-DD。
  String _dayKey(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// 把某项目会话分成 置顶 / 今天 / 昨天 / 更早 四组。置顶会话在置顶组和其
  /// 时间组同时显示（与网页端 buildSessionGroups 双显一致）。应用搜索过滤。
  List<_SessionGroup> _timeGroups(String project, BuildContext context) {
    final q = _query.trim().toLowerCase();
    final sessions = _projectSessions(project).where((s) {
      if (q.isEmpty) return true;
      return _titleOf(s).toLowerCase().contains(q) ||
          s.cwd.toLowerCase().contains(q);
    }).toList();

    final now = DateTime.now();
    final todayKey = _dayKey(now);
    final yesterdayKey = _dayKey(now.subtract(const Duration(days: 1)));

    final buckets = <_GroupKey, List<PiSession>>{
      _GroupKey.pinned: [],
      _GroupKey.today: [],
      _GroupKey.yesterday: [],
      _GroupKey.older: [],
    };
    for (final s in sessions) {
      if (_isPinned(s)) buckets[_GroupKey.pinned]!.add(s);
      final key = _dayKey(s.modified);
      if (key == todayKey) {
        buckets[_GroupKey.today]!.add(s);
      } else if (key == yesterdayKey) {
        buckets[_GroupKey.yesterday]!.add(s);
      } else {
        buckets[_GroupKey.older]!.add(s);
      }
    }
    final titles = {
      _GroupKey.pinned: context.tr('置顶'),
      _GroupKey.today: context.tr('今天'),
      _GroupKey.yesterday: context.tr('昨天'),
      _GroupKey.older: context.tr('更早'),
    };
    return [
      for (final key in _GroupKey.values)
        if (buckets[key]!.isNotEmpty)
          _SessionGroup(key, titles[key]!, buckets[key]!),
    ];
  }

  /// 会话 id → 关联任务（一个会话最多关联一个任务，取优先级最高的那个）。
  Map<String, PiTask> get _taskBySessionId {
    final map = <String, PiTask>{};
    for (final task in widget.controller.tasks) {
      final id = task.conversationId;
      if (id == null || id.isEmpty) continue;
      final existing = map[id];
      if (existing == null || _taskPriority(task) < _taskPriority(existing)) {
        map[id] = task;
      }
    }
    return map;
  }

  /// 任务优先级：进行中 > 需关注 > 待办 > 已完成（多个任务关联时取前者）。
  static int _taskPriority(PiTask task) => switch (task.status) {
    TaskStatus.preparing || TaskStatus.running => 0,
    TaskStatus.awaitingInput ||
    TaskStatus.review ||
    TaskStatus.merging ||
    TaskStatus.failed => 1,
    TaskStatus.queued || TaskStatus.todo => 2,
    TaskStatus.done || TaskStatus.canceled => 3,
    TaskStatus.unknown => 4,
  };

  /// 任务模块颜色（与网页端任务看板 COLUMN_META 对齐）：
  /// 待办→灰、进行中→主题色、需关注→琥珀、已完成→绿。
  static Color _taskIndicatorColor(PiTask task, ColorScheme scheme) =>
      switch (task.status) {
        TaskStatus.preparing || TaskStatus.running => scheme.primary,
        TaskStatus.awaitingInput ||
        TaskStatus.review ||
        TaskStatus.merging ||
        TaskStatus.failed => const Color(0xfff59e0b),
        TaskStatus.queued || TaskStatus.todo => scheme.onSurfaceVariant,
        TaskStatus.done || TaskStatus.canceled => const Color(0xff10b981),
        TaskStatus.unknown => scheme.outline,
      };

  String _taskLabel(BuildContext context, PiTask task) => switch (task.status) {
    TaskStatus.preparing || TaskStatus.running => context.tr('进行中'),
    TaskStatus.awaitingInput ||
    TaskStatus.review ||
    TaskStatus.merging ||
    TaskStatus.failed => context.tr('需关注'),
    TaskStatus.queued || TaskStatus.todo => context.tr('待办'),
    TaskStatus.done || TaskStatus.canceled => context.tr('已完成'),
    TaskStatus.unknown => context.tr('任务'),
  };

  Future<void> _openSession(PiSession session) async {
    // 立即进入会话页：消息/模型/技能在 ChatScreen 内部异步加载（有 loading
    // 指示器）。不再 await openSession 完成 —— 避免点击后长时间无响应
    // （首屏多个网络请求串行时用户感觉“点不进去”）。
    unawaited(widget.controller.openSession(session).catchError((_) {}));
    if (!mounted) return;
    // 抽屉「回首页」：ChatScreen pop 前通过 onGoHome 置 _homeRequested，
    // pop 完成后据此回到首页（不依赖 pop 返回值，时序可靠）。
    await Navigator.of(context).push<void>(
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
          onGoHome: () => _homeRequested = true,
        ),
      ),
    );
    if (!mounted) return;
    setState(() {});
    if (_homeRequested) {
      _homeRequested = false;
      _goHome();
    }
  }

  Future<void> _newChat(String cwd) async {
    // 立即进入会话页：新建会话在 ChatScreen 内部异步完成
    unawaited(widget.controller.newChat(cwd).catchError((_) {}));
    if (!mounted) return;
    // 抽屉「回首页」：ChatScreen pop 前通过 onGoHome 置 _homeRequested，
    // pop 完成后据此回到首页（不依赖 pop 返回值，时序可靠）。
    await Navigator.of(context).push<void>(
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
          onGoHome: () => _homeRequested = true,
        ),
      ),
    );
    if (!mounted) return;
    setState(() {});
    if (_homeRequested) {
      _homeRequested = false;
      _goHome();
    }
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

  /// 首页项目卡片：别名 + 真实路径 + 会话数 + 相对时间。
  /// 不显示任何“处理中”状态（项目层不展示运行态）。
  Widget _buildProjectCard(BuildContext context, String project) {
    final scheme = Theme.of(context).colorScheme;
    final sessions = _projectSessions(project);
    final latest = sessions.isEmpty ? null : sessions.first.modified;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: scheme.surfaceContainerHigh.withValues(alpha: .55),
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => _enterProject(project),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: scheme.primary.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    Icons.folder_rounded,
                    size: 18,
                    color: scheme.primary,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _aliasOf(project, project),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: scheme.onSurface,
                        ),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        _pathLabel(project, project),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 9.5,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                if (latest != null)
                  Text(
                    _relativeTime(latest),
                    style: TextStyle(
                      fontSize: 9.5,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '${sessions.length}',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                Icon(
                  Icons.chevron_right_rounded,
                  size: 18,
                  color: scheme.outline,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// 项目页头部：回首页 + 项目名/路径 + 新建会话。
  Widget _buildProjectHeader(
    BuildContext context,
    ColorScheme scheme,
    String? project,
  ) {
    final hasProject = project != null;
    final alias = hasProject ? _aliasOf(project, project) : context.tr('选择项目');
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 10, 12, 4),
      child: Row(
        children: [
          IconButton(
            tooltip: context.tr('回首页'),
            icon: const Icon(Icons.arrow_back_rounded),
            onPressed: _goHome,
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  alias,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: scheme.onSurface,
                  ),
                ),
                if (hasProject) ...[
                  const SizedBox(height: 1),
                  Text(
                    project,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 10,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (hasProject)
            IconButton(
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints.tightFor(width: 34, height: 34),
              iconSize: 18,
              tooltip: context.tr('新建会话'),
              icon: Icon(Icons.add_circle_outline_rounded, color: scheme.primary),
              // 点加号先选目录（含目录选择器），再进入新会话，而非直接进对话页
              onPressed: () async {
                final selected = await showDirectoryPicker(
                  context,
                  controller: widget.controller,
                  initialPath: project,
                );
                if (selected == null || selected.isEmpty || !mounted) return;
                await _newChat(selected);
              },
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // 首页：所有项目目录页。
    if (_atHome) {
      return _buildHomePage(context, scheme);
    }
    // 项目页：选中项目的会话列表（按置顶/今天/昨天/更早 分组）。
    final roots = _projectRoots;
    final project = (_selectedProject != null && roots.contains(_selectedProject))
        ? _selectedProject
        : (roots.isNotEmpty ? roots.first : null);
    return _buildProjectPage(context, scheme, project);
  }

  /// 首页：项目目录页（全部项目，可折叠）。项目层级不显示“处理中”——
  /// 运行状态只在单个会话卡片内展示。
  Widget _buildHomePage(BuildContext context, ColorScheme scheme) {
    final projects = _projectRoots;
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
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : projects.isEmpty
                    ? _buildEmpty(context, scheme, false)
                    : RefreshIndicator(
                        onRefresh: _refreshAll,
                        child: ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                          children: [
                            _SessionAccordion(
                              title: context.tr('项目'),
                              count: projects.length,
                              expanded: _homeExpanded,
                              onToggle: () => setState(
                                () => _homeExpanded = !_homeExpanded,
                              ),
                              children: [
                                for (final p in projects)
                                  _buildProjectCard(context, p),
                              ],
                            ),
                          ],
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// 项目页：选中项目的会话列表（项目选择器退居幕后，顶部为回首页 + 项目名）。
  Widget _buildProjectPage(
    BuildContext context,
    ColorScheme scheme,
    String? project,
  ) {
    final groups = project == null ? const <_SessionGroup>[] : _timeGroups(project, context);
    final taskMap = _taskBySessionId;
    final searching = _query.trim().isNotEmpty;

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
              _buildProjectHeader(context, scheme, project),
              _buildSearch(context),
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : project == null
                    ? _buildEmpty(context, scheme, searching)
                    : groups.isEmpty
                    ? _buildEmpty(context, scheme, searching)
                    : RefreshIndicator(
                        onRefresh: _refreshAll,
                        child: ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                          children: [
                            for (final group in groups)
                              _SessionAccordion(
                                title: group.title,
                                count: group.sessions.length,
                                // 搜索时强制展开所有分组（与网页端一致）。
                                expanded: searching || !_collapsedGroups.contains(group.key),
                                onToggle: () => setState(() {
                                  if (!_collapsedGroups.add(group.key)) {
                                    _collapsedGroups.remove(group.key);
                                  }
                                }),
                                children: [
                                  for (final s in group.sessions)
                                    _buildSessionCard(context, s, taskMap[s.id]),
                                ],
                              ),
                          ],
                        ),
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

  Widget _buildSessionCard(BuildContext context, PiSession s, PiTask? task) {
    final scheme = Theme.of(context).colorScheme;
    final pinned = _isPinned(s);
    final pathLabel = _pathLabel(s.projectRoot, s.cwd);
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
                        Theme.of(context).colorScheme.primary,
                        Theme.of(
                          context,
                        ).colorScheme.primary.withValues(alpha: .65),
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
                      // Line 1: 任务颜色标识 + 标题 + 置顶图标
                      Row(
                        children: [
                          if (task != null)
                            Tooltip(
                              message: '${context.tr('任务')} · '
                                  '${_taskLabel(context, task)} — ${task.title}',
                              child: Container(
                                width: 8,
                                height: 8,
                                margin: const EdgeInsets.only(right: 5),
                                decoration: BoxDecoration(
                                  color: _taskIndicatorColor(task, scheme),
                                  shape: BoxShape.circle,
                                ),
                              ),
                            ),
                          Expanded(
                            child: Text(
                              _titleOf(s),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: scheme.onSurface,
                              ),
                            ),
                          ),
                          const SizedBox(width: 4),
                          IconButton(
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints.tightFor(width: 26, height: 26),
                            iconSize: 16,
                            tooltip: pinned ? context.tr('取消置顶') : context.tr('置顶'),
                            icon: Icon(
                              pinned ? Icons.push_pin : Icons.push_pin_outlined,
                              color: pinned ? scheme.primary : scheme.onSurfaceVariant,
                            ),
                            onPressed: () => _togglePinned(s),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      // Line 2: 备注名称 · 相对时间 · 消息数 · 分支 · fork
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              pathLabel,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 9.5,
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _relativeTime(s.modified),
                            style: TextStyle(
                              fontSize: 9,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            context.tr('{count} 条消息', {
                              'count': s.messageCount,
                            }),
                            style: TextStyle(
                              fontSize: 9,
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
    final pinned = _isPinned(s);
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
              leading: const Icon(Icons.auto_awesome_rounded),
              title: Text(context.tr('生成标题')),
              onTap: () => Navigator.of(sheetContext).pop('autoName'),
            ),
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
      case 'autoName':
        await widget.controller.autoNameSession(s.id);
        if (mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(context.tr('标题已生成'))));
        }
      case 'rename':
        await _renameSession(context, s);
      case 'pin':
        await _togglePinned(s);
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

  Widget _buildEmpty(BuildContext context, ColorScheme scheme, bool searching) {
    final noProject = _projectRoots.isEmpty;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            noProject ? Icons.folder_open_rounded : Icons.forum_outlined,
            size: 44,
            color: scheme.onSurfaceVariant,
          ),
          const SizedBox(height: 12),
          Text(
            noProject
                ? context.tr('暂无项目')
                : searching
                ? context.tr('没有匹配的会话')
                : context.tr('暂无会话'),
            style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
          ),
          if (noProject) ...[
            const SizedBox(height: 16),
            // 无任何项目/会话时：新增入口（选择目录并开始对话）
            FilledButton.icon(
              key: const Key('empty-pick-project'),
              icon: const Icon(Icons.add_rounded, size: 18),
              label: Text(context.tr('选择项目')),
              onPressed: () async {
                final selected = await showDirectoryPicker(
                  context,
                  controller: widget.controller,
                );
                if (selected == null || selected.isEmpty || !mounted) return;
                await _newChat(selected);
              },
            ),
          ],
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

/// 手风琴分组卡片（参考网页端 SessionSidebar 的 AccordionGroup）：
/// 圆角卡片 + 展开箭头（收起旋转）+ 大写小标题 + 数量徽章 + 右侧收起/展开提示。
class _SessionAccordion extends StatelessWidget {
  const _SessionAccordion({
    required this.title,
    required this.count,
    required this.expanded,
    required this.onToggle,
    required this.children,
  });

  final String title;
  final int count;
  final bool expanded;
  final VoidCallback onToggle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHigh.withValues(alpha: .5),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: .35)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  AnimatedRotation(
                    turns: expanded ? 0 : -0.25,
                    duration: const Duration(milliseconds: 160),
                    child: Icon(
                      Icons.expand_more_rounded,
                      size: 16,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.8,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerHighest.withValues(alpha: .8),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '$count',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const Spacer(),
                  Text(
                    expanded ? context.tr('收起') : context.tr('展开'),
                    style: TextStyle(fontSize: 10, color: scheme.outline),
                  ),
                ],
              ),
            ),
          ),
          if (expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(6, 0, 6, 6),
              child: Column(
                children: [
                  for (var i = 0; i < children.length; i++) ...[
                    if (i > 0) const SizedBox(height: 6),
                    children[i],
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}
