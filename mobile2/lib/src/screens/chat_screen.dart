import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../apple_theme.dart';
import '../font_scale.dart';
import '../chat_controller.dart';
import '../localization.dart';
import '../models.dart';
import '../profile_store.dart';
import '../widgets/accent_picker.dart';
import '../widgets/context_ring.dart';
import '../widgets/copy_sheet.dart';
import 'directory_picker.dart';
import 'git_sheet.dart';
import 'mcp_sheet.dart';
import 'model_picker.dart';
import 'providers_sheet.dart';
import 'skills_sheet.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.controller,
    required this.profile,
    required this.onLogout,
    this.onSwitchServer,
    this.themeMode = ThemeMode.system,
    this.onThemeModeChanged,
    this.compactOutput = true,
    this.onCompactOutputChanged,
    this.languagePreference = AppLanguagePreference.system,
    this.onLanguagePreferenceChanged,
    this.themeSetName = '',
    this.onThemeSetChanged,
    this.accent = AppleColors.accent,
    this.onAccentChanged,
  });

  final ChatController controller;
  final ServerProfile profile;
  final Future<void> Function() onLogout;
  final Future<void> Function(String id)? onSwitchServer;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode>? onThemeModeChanged;
  final bool compactOutput;
  final ValueChanged<bool>? onCompactOutputChanged;
  final AppLanguagePreference languagePreference;
  final ValueChanged<AppLanguagePreference>? onLanguagePreferenceChanged;
  final String themeSetName;
  final ValueChanged<String>? onThemeSetChanged;

  /// User-selectable accent color (drives primary actions / bubble tints).
  final Color accent;
  final ValueChanged<Color>? onAccentChanged;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  bool _stickToBottom = true;
  bool _showJumpToBottom = false;
  bool _slashCommandsRequested = false;
  bool _slashViewCompact = true; // true=横排chips, false=竖排分组列表
  bool _postFrameScheduled = false;
  bool _pickingImages = false;
  /// 过程显示模式：'tabs'（横向块状，默认）| 'timeline'（树形）。
  String _processDisplayMode = 'tabs';
  String? _visibleSessionId;
  final List<_PendingImage> _pendingImages = [];

  // ── @ file reference & # snippet autocomplete ───────────────────────
  String? _atQuery;
  List<String> _atMatches = const [];
  String? _hashQuery;
  List<PiSnippet> _hashMatches = const [];
  List<String> _fileIndex = const [];
  List<PiSnippet> _snippets = const [];
  bool _fileIndexLoading = false;
  String? _fileIndexCwd;
  bool _fileIndexLoaded = false;

  List<PiSlashCommand> get _builtinSlashCommands => <PiSlashCommand>[
    PiSlashCommand(
      name: 'compact',
      description: context.tr('压缩当前对话上下文'),
      source: 'builtin',
    ),
    PiSlashCommand(
      name: 'reload',
      description: context.tr('重新加载会话、模型和资源'),
      source: 'builtin',
    ),
    PiSlashCommand(
      name: 'name',
      description: context.tr('设置当前对话名称'),
      source: 'builtin',
    ),
    PiSlashCommand(
      name: 'session',
      description: context.tr('查看当前会话统计信息'),
      source: 'builtin',
    ),
    PiSlashCommand(
      name: 'copy',
      description: context.tr('复制最后一条助手回复'),
      source: 'builtin',
    ),
  ];

  ChatController get chat => widget.controller;

  @override
  void initState() {
    super.initState();
    _visibleSessionId = chat.activeSessionId;
    chat.addListener(_onChanged);
    _messageController.addListener(_onComposerChanged);
    _scrollController.addListener(_trackScrollPosition);
    _restoreProcessDisplayMode();
  }

  /// 读取过程显示模式偏好（与网页端 pi-process-display-mode 同语义）。
  Future<void> _restoreProcessDisplayMode() async {
    final preferences = await SharedPreferences.getInstance();
    final stored = preferences.getString('pi-process-display-mode');
    if (mounted && (stored == 'tabs' || stored == 'timeline')) {
      setState(() => _processDisplayMode = stored!);
    }
  }

  /// 切换过程显示模式并持久化。
  Future<void> _setProcessDisplayMode(String mode) async {
    if (mode == _processDisplayMode) return;
    setState(() => _processDisplayMode = mode);
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString('pi-process-display-mode', mode);
  }

  @override
  void dispose() {
    chat.removeListener(_onChanged);
    _messageController.removeListener(_onComposerChanged);
    _scrollController.removeListener(_trackScrollPosition);
    _saveDraft();
    _messageController.dispose();
    _scrollController.dispose();
    _pendingImages.clear();
    super.dispose();
  }

  /// Persists the current composer text under the active session so a quick
  /// app kill / session switch doesn't lose what the user was typing.
  void _saveDraft() {
    final sessionId = chat.activeSessionId;
    if (sessionId == null || sessionId.isEmpty) return;
    final text = _messageController.text.trim();
    unawaited(_writeDraft(sessionId, text));
  }

  Future<void> _writeDraft(String sessionId, String text) async {
    final prefs = await SharedPreferences.getInstance();
    if (text.isEmpty) {
      await prefs.remove('pi-draft-$sessionId');
    } else {
      await prefs.setString('pi-draft-$sessionId', text);
    }
  }

  /// Restores a saved draft for [sessionId] into the composer (called when
  /// the active session changes).
  Future<void> _loadDraft(String sessionId) async {
    final prefs = await SharedPreferences.getInstance();
    final draft = prefs.getString('pi-draft-$sessionId') ?? '';
    if (!mounted) return;
    if (_messageController.text.trim().isEmpty && draft.isNotEmpty) {
      _messageController.text = draft;
      _messageController.selection = TextSelection.collapsed(
        offset: draft.length,
      );
    }
  }

  void _onChanged() {
    if (!mounted) return;
    if (_visibleSessionId != chat.activeSessionId || chat.messages.isEmpty) {
      _visibleSessionId = chat.activeSessionId;
      _stickToBottom = true;
      _showJumpToBottom = false;
      final sessionId = chat.activeSessionId;
      if (sessionId != null && sessionId.isNotEmpty) {
        unawaited(_loadDraft(sessionId));
      }
    }
    setState(() {});
    if (_postFrameScheduled) return;
    _postFrameScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _postFrameScheduled = false;
      if (!mounted) return;
      if (_stickToBottom && _scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _trackScrollPosition() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    final distanceToBottom = position.maxScrollExtent - position.pixels;
    _stickToBottom = distanceToBottom < 100;
    final shouldShow = distanceToBottom > 160;
    if (shouldShow != _showJumpToBottom && mounted) {
      setState(() => _showJumpToBottom = shouldShow);
    }
  }

  String? get _slashQuery {
    final value = _messageController.text;
    if (!value.startsWith('/')) return null;
    final query = value.substring(1);
    return RegExp(r'\s').hasMatch(query) ? null : query.toLowerCase();
  }

  /// Detects an `@` or `#` token immediately before the caret (same rules as
  /// the web client: token must be at line start or preceded by whitespace).
  /// Returns the token prefix char and query, or null when not in a token.
  ({String prefix, String query})? _extractAutocompleteToken() {
    final value = _messageController.text;
    final pos = _messageController.selection.isValid
        ? _messageController.selection.start
        : value.length;
    final before = value.substring(0, pos);
    final atMatch = RegExp(r'(?:^|\s)@([^\s\n]*)$').firstMatch(before);
    if (atMatch != null) {
      return (prefix: '@', query: atMatch.group(1) ?? '');
    }
    final hashMatch = RegExp(r'(?:^|\s)#([^\s\n]*)$').firstMatch(before);
    if (hashMatch != null) {
      return (prefix: '#', query: hashMatch.group(1) ?? '');
    }
    return null;
  }

  void _onComposerChanged() {
    if (!mounted) return;
    final token = _extractAutocompleteToken();
    if (token != null && token.prefix == '@') {
      _slashCommandsRequested = false;
      _hashQuery = null;
      _hashMatches = const [];
      _atQuery = token.query;
      _filterAtMatches();
      _ensureFileIndex();
      setState(() {});
      return;
    }
    if (token != null && token.prefix == '#') {
      _slashCommandsRequested = false;
      _atQuery = null;
      _atMatches = const [];
      _hashQuery = token.query;
      _filterHashMatches();
      _ensureSnippets();
      setState(() {});
      return;
    }
    _atQuery = null;
    _atMatches = const [];
    _hashQuery = null;
    _hashMatches = const [];
    final query = _slashQuery;
    if (query == null) {
      _slashCommandsRequested = false;
      setState(() {});
      return;
    }
    setState(() {});
    if (!_slashCommandsRequested) {
      _slashCommandsRequested = true;
      chat.loadSlashCommands();
    }
  }

  void _filterAtMatches() {
    final query = _atQuery?.toLowerCase() ?? '';
    final all = _fileIndex;
    if (query.isEmpty) {
      // Cap the empty-query list: repos can hold thousands of files and the
      // panel builds every row eagerly per keystroke.
      _atMatches = all.take(60).toList();
      return;
    }
    _atMatches = all
        .where((path) => path.toLowerCase().contains(query))
        .take(30)
        .toList();
  }

  void _filterHashMatches() {
    final query = _hashQuery?.toLowerCase() ?? '';
    final all = _snippets;
    if (query.isEmpty) {
      _hashMatches = all;
      return;
    }
    _hashMatches = all
        .where((snippet) => snippet.name.toLowerCase().contains(query))
        .take(30)
        .toList();
  }

  Future<void> _ensureFileIndex() async {
    final cwd = chat.draftCwd;
    if (cwd == null || cwd.isEmpty) return;
    if (_fileIndexCwd == cwd && _fileIndexLoaded) return;
    if (_fileIndexLoading) return;
    _fileIndexLoading = true;
    final files = await chat.api.getFileIndex(cwd);
    if (!mounted) return;
    _fileIndexLoading = false;
    _fileIndexCwd = cwd;
    _fileIndex = files;
    _fileIndexLoaded = true;
    if (_atQuery != null) {
      _filterAtMatches();
      setState(() {});
    }
  }

  Future<void> _ensureSnippets() async {
    if (_snippets.isNotEmpty) return;
    final snippets = await chat.api.getSnippets();
    if (!mounted) return;
    _snippets = snippets;
    if (_hashQuery != null) {
      _filterHashMatches();
      setState(() {});
    }
  }

  void _applyAtMatch(String path) {
    final value = _messageController.text;
    final pos = _messageController.selection.isValid
        ? _messageController.selection.start
        : value.length;
    final before = value.substring(0, pos);
    final after = value.substring(pos);
    final match = RegExp(r'(?:^|\s)@([^\s\n]*)$').firstMatch(before);
    final start = match == null
        ? pos
        : match.start + match.group(0)!.indexOf('@');
    final insert = '@$path ';
    final newValue = value.substring(0, start) + insert + after;
    _messageController.value = TextEditingValue(
      text: newValue,
      selection: TextSelection.collapsed(offset: start + insert.length),
    );
    _atQuery = null;
    _atMatches = const [];
  }

  void _applyHashMatch(PiSnippet snippet) {
    final value = _messageController.text;
    final pos = _messageController.selection.isValid
        ? _messageController.selection.start
        : value.length;
    final before = value.substring(0, pos);
    final after = value.substring(pos);
    final match = RegExp(r'(?:^|\s)#([^\s\n]*)$').firstMatch(before);
    final start = match == null
        ? pos
        : match.start + match.group(0)!.indexOf('#');
    final newValue = value.substring(0, start) + snippet.content + after;
    _messageController.value = TextEditingValue(
      text: newValue,
      selection: TextSelection.collapsed(
        offset: start + snippet.content.length,
      ),
    );
    _hashQuery = null;
    _hashMatches = const [];
  }

  List<PiSlashCommand> get _filteredSlashCommands {
    final query = _slashQuery;
    if (query == null) return const [];
    final dormantSkills = _dormantSkillNames;
    final commands = [..._builtinSlashCommands, ...chat.slashCommands].where((
      command,
    ) {
      if (command.isSkill && dormantSkills.contains(command.skillName)) {
        return false;
      }
      final name = command.name.toLowerCase();
      final description = command.description.toLowerCase();
      return name.contains(query) || description.contains(query);
    }).toList();
    int rank(PiSlashCommand command) {
      final name = command.name.toLowerCase();
      if (name == query) return 0;
      if (name.startsWith(query)) return 1;
      if (name.contains(query)) return 2;
      return 3;
    }

    const sourceOrder = {'builtin': 0, 'extension': 1, 'prompt': 2, 'skill': 3};
    commands.sort((a, b) {
      final byRank = rank(a).compareTo(rank(b));
      if (byRank != 0) return byRank;
      final bySource = (sourceOrder[a.source] ?? 4).compareTo(
        sourceOrder[b.source] ?? 4,
      );
      if (bySource != 0) return bySource;
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    return commands;
  }

  Set<String> get _dormantSkillNames => chat.skills
      .where((skill) => skill.disableModelInvocation)
      .map((skill) => skill.name)
      .toSet();

  void _applySlashCommand(PiSlashCommand command) {
    final value = '/${command.name} ';
    _messageController.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
  }

  void _onToggleSlashView() {
    setState(() => _slashViewCompact = !_slashViewCompact);
  }

  Future<void> _scrollToBottom() async {
    if (!_scrollController.hasClients) return;
    _stickToBottom = true;
    if (_showJumpToBottom) {
      setState(() => _showJumpToBottom = false);
    }
    await _scrollController.animateTo(
      _scrollController.position.maxScrollExtent,
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
    );
  }

  /// 计划模式：切换 collaborationMode 为 plan（与网页端一致）。
  Future<void> _setPlanMode() async {
    if (chat.running) return;
    final ok = await chat.setCollaborationMode('plan');
    if (mounted && ok) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(context.tr('已切换到计划模式'))));
    }
  }

  /// 目标模式：弹出目标输入框，启动 goal_start（与网页端 GoalBanner 流程一致）。
  Future<void> _setGoalMode() async {
    final controller = TextEditingController(text: chat.goalText ?? '');
    final text = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(dialogContext.tr('设定目标')),
        content: TextField(
          controller: controller,
          autofocus: true,
          minLines: 2,
          maxLines: 5,
          decoration: InputDecoration(hintText: dialogContext.tr('要达到什么目标？')),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(dialogContext.tr('取消')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text),
            child: Text(dialogContext.tr('开始')),
          ),
        ],
      ),
    );
    controller.dispose();
    if (text == null || !mounted) return;
    final ok = await chat.startGoal(text);
    if (mounted && ok) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(context.tr('目标已启动'))));
    }
  }

  /// 使用命令：在输入框插入 "/" 并聚焦，唤起快捷命令面板。
  void _useCommand() {
    final current = _messageController.text;
    final next = current.startsWith('/') ? current : '/$current';
    _messageController.text = next;
    _messageController.selection = TextSelection.collapsed(offset: next.length);
  }

  /// 引用对话：弹出会话选择器，把所选会话的内容摘要插入输入框。
  Future<void> _referenceSession() async {
    final sessions = chat.sessions;
    if (sessions.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(context.tr('暂无可引用的对话'))));
      }
      return;
    }
    final selected = await showModalBottomSheet<PiSession>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => _SessionReferenceSheet(
        sessions: sessions,
        language: context.appLanguage,
      ),
    );
    if (selected == null || !mounted) return;
    final reference = await chat.buildSessionReference(selected);
    if (reference == null) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(context.tr('引用内容加载失败'))));
      }
      return;
    }
    final current = _messageController.text;
    final sep = current.isEmpty ? '' : '\n\n';
    _messageController.text = '$current$sep$reference';
    _messageController.selection = TextSelection.collapsed(
      offset: _messageController.text.length,
    );
  }

  Future<void> _send({String? queueMode}) async {
    final value = _messageController.text;
    if (value.trim().isEmpty && _pendingImages.isEmpty) return;
    // While the agent is running, builtin slash commands that mutate session
    // state are unsafe; enqueue them as a steer instead.
    final builtin = _pendingImages.isEmpty && !chat.running
        ? await chat.executeBuiltinCommand(value)
        : const BuiltinCommandResult(handled: false);
    if (builtin.handled) {
      if (builtin.error != null) {
        if (mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(builtin.error!)));
        }
        return;
      }
      if (builtin.copyText != null) {
        await Clipboard.setData(ClipboardData(text: builtin.copyText!));
      }
      _messageController.clear();
      if (!mounted) return;
      if (builtin.details != null) {
        await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(context.tr('会话信息')),
            content: SingleChildScrollView(
              child: SelectableText(
                builtin.details!,
                style: const TextStyle(fontFamily: 'monospace'),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(context.tr('关闭')),
              ),
            ],
          ),
        );
      } else if (builtin.message != null) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(builtin.message!)));
      }
      return;
    }
    _stickToBottom = true;
    _messageController.clear();
    final sessionId = chat.activeSessionId;
    if (sessionId != null && sessionId.isNotEmpty) {
      unawaited(_writeDraft(sessionId, ''));
    }
    final images = _pendingImages.map((image) => image.attachment).toList();
    setState(_pendingImages.clear);
    // When the agent is running, the message is enqueued (steer by default,
    // followUp when the send key was long-pressed).
    final effectiveMode = chat.running
        ? (queueMode == 'followUp' ? 'followUp' : 'steer')
        : null;
    await chat.send(value, images: images, queueMode: effectiveMode);
  }

  Future<void> _pickImages() async {
    if (chat.running ||
        _pendingImages.length >= 10 ||
        _pickingImages ||
        !mounted) {
      return;
    }
    _pickingImages = true;
    try {
      final files = await ImagePicker().pickMultiImage(
        imageQuality: 88,
        maxWidth: 2048,
        maxHeight: 2048,
      );
      if (!mounted || files.isEmpty) return;
      var rejected = 0;
      final available = 10 - _pendingImages.length;
      final selected = <_PendingImage>[];
      for (final file in files.take(available)) {
        final bytes = await file.readAsBytes();
        if (bytes.length > 10 * 1024 * 1024) {
          rejected += 1;
          continue;
        }
        selected.add(
          _PendingImage(
            bytes: bytes,
            attachment: PiImageAttachment(
              data: base64Encode(bytes),
              mimeType: file.mimeType ?? _mimeTypeFor(file.name),
            ),
          ),
        );
      }
      if (!mounted) return;
      setState(() => _pendingImages.addAll(selected));
      if (files.length > available || rejected > 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('最多添加 10 张图片，且每张不能超过 10 MB'))),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(context.tr('无法读取所选图片'))));
      }
    } finally {
      _pickingImages = false;
    }
  }

  String _mimeTypeFor(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  static const _textFileExtensions = {
    '.txt',
    '.md',
    '.markdown',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.csv',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.dart',
    '.py',
    '.rb',
    '.go',
    '.rs',
    '.java',
    '.c',
    '.h',
    '.cpp',
    '.hpp',
    '.css',
    '.scss',
    '.html',
    '.xml',
    '.sh',
    '.bash',
    '.zsh',
    '.sql',
    '.log',
    '.ini',
    '.cfg',
    '.env',
  };

  /// 任意文件上传：图片并入附件预览；文本类文件内容注入输入框；其他类型拒绝。
  Future<void> _pickFiles() async {
    if (_pickingImages || !mounted) return;
    _pickingImages = true;
    try {
      final result = await FilePicker.platform.pickFiles(
        allowMultiple: true,
        withData: false,
      );
      if (!mounted || result == null || result.files.isEmpty) return;
      var rejected = 0;
      var imageCount = 0;
      for (final file in result.files) {
        final name = file.name;
        final lower = name.toLowerCase();
        final isImage = const {
          '.png',
          '.jpg',
          '.jpeg',
          '.gif',
          '.webp',
          '.heic',
        }.any(lower.endsWith);
        if (isImage) {
          // Route images through the existing attachment pipeline (10 max).
          if (_pendingImages.length >= 10 || imageCount >= 10) {
            rejected += 1;
            continue;
          }
          final path = file.path;
          if (path == null) {
            rejected += 1;
            continue;
          }
          final bytes = await File(path).readAsBytes();
          if (bytes.length > 10 * 1024 * 1024) {
            rejected += 1;
            continue;
          }
          setState(() {
            _pendingImages.add(
              _PendingImage(
                bytes: bytes,
                attachment: PiImageAttachment(
                  data: base64Encode(bytes),
                  mimeType: _mimeTypeFor(name),
                ),
              ),
            );
          });
          imageCount += 1;
          continue;
        }
        if (!_textFileExtensions.any(lower.endsWith)) {
          rejected += 1;
          continue;
        }
        final path = file.path;
        if (path == null) {
          rejected += 1;
          continue;
        }
        final stat = await File(path).stat();
        if (stat.size > 512 * 1024) {
          rejected += 1;
          continue;
        }
        String content;
        try {
          content = await File(path).readAsString();
        } catch (_) {
          rejected += 1;
          continue;
        }
        if (content.length > 20000) {
          content = '${content.substring(0, 20000)}\n…（已截断）';
        }
        final current = _messageController.text;
        final sep = current.isEmpty ? '' : '\n\n';
        final injected = '```\n$name 内容：\n$content\n```';
        _messageController.text = '$current$sep$injected';
        _messageController.selection = TextSelection.collapsed(
          offset: _messageController.text.length,
        );
      }
      if (rejected > 0 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              context.tr('{count} 个文件被跳过：仅支持文本文件（≤512KB）和图片（≤10MB）', {
                'count': rejected,
              }),
            ),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(context.tr('无法读取所选文件'))));
      }
    } finally {
      _pickingImages = false;
    }
  }

  Future<void> _chooseNewChat() async {
    Navigator.maybePop(context);
    final selected = await showDirectoryPicker(
      context,
      controller: chat,
      initialPath: chat.draftCwd ?? chat.knownCwds.firstOrNull,
    );
    if (selected == null || selected.isEmpty) return;
    await chat.newChat(selected);
    if (mounted && chat.models.isNotEmpty) {
      await showModelPicker(context, controller: chat);
    }
  }

  Future<void> _startNewChat() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final cwd = chat.draftCwd;
    if (cwd == null || cwd.isEmpty) {
      await _chooseNewChat();
      return;
    }
    _messageController.clear();
    _stickToBottom = true;
    await chat.newChat(cwd, model: chat.selectedModel);
  }

  /// Switches to a recent project: starts a fresh chat in that directory.
  Future<void> _switchProject(String cwd) async {
    FocusManager.instance.primaryFocus?.unfocus();
    _messageController.clear();
    _stickToBottom = true;
    await chat.newChat(cwd, model: chat.selectedModel);
  }

  Future<void> _confirmDeleteSession(PiSession session) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.delete_outline),
        title: Text(context.tr('删除对话？')),
        content: Text(
          context.tr('“{title}”将从服务器永久删除，此操作无法撤销。', {
            'title': session.titleFor(context.appLanguage),
          }),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.tr('取消')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            child: Text(context.tr('删除')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await chat.deleteSession(session);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(context.tr('对话已删除'))));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(context.tr('删除失败，请稍后重试'))));
      }
    }
  }

  Future<void> _showServerSwitcher(BuildContext context) async {
    final callback = widget.onSwitchServer;
    if (callback == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => ServerSwitcherSheet(
        currentId: widget.profile.id,
        onSwitch: (id) {
          Navigator.pop(sheetContext);
          unawaited(callback(id));
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      drawer: _SessionDrawer(
        controller: chat,
        onNewChat: _startNewChat,
        onOpen: (session) {
          Navigator.pop(context);
          chat.openSession(session);
        },
        onDelete: _confirmDeleteSession,
        onLogout: widget.onLogout,
        onSwitchServer: widget.onSwitchServer == null
            ? null
            : () => _showServerSwitcher(context),
        onSwitchProject: _switchProject,
      ),
      endDrawerEnableOpenDragGesture: true,
      endDrawer: _FunctionDrawer(
        controller: chat,
        server: widget.profile.baseUrl,
        themeMode: widget.themeMode,
        compactOutput: widget.compactOutput,
        onThemeModeChanged: widget.onThemeModeChanged,
        onCompactOutputChanged: widget.onCompactOutputChanged,
        languagePreference: widget.languagePreference,
        onLanguagePreferenceChanged: widget.onLanguagePreferenceChanged,
        themeSetName: widget.themeSetName,
        onThemeSetChanged: widget.onThemeSetChanged,
        accent: widget.accent,
        onAccentChanged: widget.onAccentChanged,
        onChooseDirectory: _chooseNewChat,
        onSkills: () {
          Navigator.pop(context);
          showSkillsSheet(context, controller: chat);
        },
        onGit: () {
          Navigator.pop(context);
          showGitSheet(context, controller: chat);
        },
        onProviders: () {
          Navigator.pop(context);
          showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            useSafeArea: true,
            backgroundColor: Colors.transparent,
            builder: (sheetContext) => ProvidersSheet(controller: chat),
          );
        },
        onMcp: () {
          Navigator.pop(context);
          showMcpSheet(context, controller: chat);
        },
        onSwitchServer: widget.onSwitchServer == null
            ? null
            : () => _showServerSwitcher(context),
      ),
      appBar: AppBar(
        toolbarHeight: 72,
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: true,
        leadingWidth: 68,
        leading: Padding(
          padding: const EdgeInsets.only(left: 12),
          child: _RoundToolbarButton(
            tooltip: context.tr('打开对话菜单'),
            icon: Icons.menu_rounded,
            onPressed: () => _scaffoldKey.currentState?.openDrawer(),
          ),
        ),
        title: LayoutBuilder(
          builder: (context, constraints) {
            final availableWidth = constraints.maxWidth.isFinite
                ? constraints.maxWidth
                : 180.0;
            final pillWidth = availableWidth.clamp(0.0, 180.0).toDouble();

            return Align(
              alignment: Alignment.center,
              child: SizedBox(
                width: pillWidth,
                child: Tooltip(
                  message: context.tr('选择模型'),
                  child: Material(
                    clipBehavior: Clip.antiAlias,
                    color: Theme.of(context).colorScheme.surfaceContainerHigh,
                    borderRadius: BorderRadius.circular(999),
                    child: InkWell(
                      key: const Key('top-model-picker'),
                      onTap: chat.loadingModels
                          ? null
                          : () => showModelPicker(context, controller: chat),
                      borderRadius: BorderRadius.circular(999),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 11,
                        ),
                        child: Row(
                          children: [
                            if (chat.changingModel)
                              const SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            else
                              Icon(
                                Icons.auto_awesome_rounded,
                                size: 19,
                                color: Theme.of(context).colorScheme.primary,
                              ),
                            const SizedBox(width: 7),
                            Expanded(
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  chat.selectedModel?.name ??
                                      context.tr('选择模型'),
                                  maxLines: 1,
                                  softWrap: false,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                  value: 'tabs',
                  icon: Icon(Icons.view_week_outlined, size: 15),
                  tooltip: '横向显示',
                ),
                ButtonSegment(
                  value: 'timeline',
                  icon: Icon(Icons.account_tree_outlined, size: 15),
                  tooltip: '树形显示',
                ),
              ],
              selected: {_processDisplayMode},
              onSelectionChanged: (selection) =>
                  _setProcessDisplayMode(selection.first),
              showSelectedIcon: false,
              style: ButtonStyle(
                visualDensity: VisualDensity.compact,
                padding: WidgetStatePropertyAll(
                  const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
                ),
                side: WidgetStatePropertyAll(
                  BorderSide(
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                ),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: _RoundToolbarButton(
              key: const Key('function-display-button'),
              onPressed: () => _scaffoldKey.currentState?.openEndDrawer(),
              tooltip: context.tr('功能与显示'),
              icon: Icons.tune_rounded,
            ),
          ),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final chatColumn = Column(
            children: [
              _SessionInfoBar(chat: chat),
              if (chat.status != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  color: Theme.of(
                    context,
                  ).colorScheme.primary.withValues(alpha: .08),
                  child: Row(
                    children: [
                      const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      const SizedBox(width: 10),
                      Expanded(child: Text(chat.status!)),
                    ],
                  ),
                ),
              if (chat.error != null)
                MaterialBanner(
                  content: Text(chat.error!),
                  leading: Icon(
                    Icons.error_outline,
                    color: Theme.of(context).colorScheme.error,
                  ),
                  actions: [
                    TextButton(
                      onPressed: chat.dismissError,
                      child: Text(context.tr('关闭')),
                    ),
                  ],
                ),
              Expanded(
                child: Stack(
                  alignment: Alignment.bottomCenter,
                  children: [
                    Positioned.fill(child: _conversation()),
                    Positioned(
                      bottom: 12,
                      child: AnimatedSwitcher(
                        duration: MediaQuery.disableAnimationsOf(context)
                            ? Duration.zero
                            : const Duration(milliseconds: 220),
                        transitionBuilder: (child, animation) => FadeTransition(
                          opacity: animation,
                          child: ScaleTransition(
                            scale: animation,
                            child: child,
                          ),
                        ),
                        child: _showJumpToBottom
                            ? AppleGlass(
                                key: const ValueKey('jump-to-bottom'),
                                borderRadius: BorderRadius.circular(999),
                                child: SizedBox.square(
                                  dimension: 48,
                                  child: IconButton(
                                    key: const Key('jump-to-bottom-button'),
                                    onPressed: _scrollToBottom,
                                    tooltip: context.tr('跳到最新消息'),
                                    icon: const Icon(
                                      Icons.arrow_downward_rounded,
                                    ),
                                  ),
                                ),
                              )
                            : const SizedBox.shrink(key: ValueKey('at-bottom')),
                      ),
                    ),
                  ],
                ),
              ),
              if (chat.goalStatus != null &&
                  chat.goalText != null &&
                  const {
                    'running',
                    'paused',
                    'blocked',
                  }.contains(chat.goalStatus))
                _GoalBanner(
                  status: chat.goalStatus!,
                  goalText: chat.goalText!,
                  elapsedSeconds: chat.goalElapsedSeconds,
                  onPause: chat.pauseGoal,
                  onResume: chat.resumeGoal,
                  onStop: chat.stopGoal,
                ),

              _Composer(
                controller: _messageController,
                running: chat.running,
                slashQuery: _slashQuery,
                slashCommands: _filteredSlashCommands,
                slashCommandsLoading: chat.loadingSlashCommands,
                dormantSkillNames: _dormantSkillNames,
                slashViewCompact: _slashViewCompact,
                onToggleSlashView: _onToggleSlashView,
                pendingImages: _pendingImages,
                onSlashCommand: _applySlashCommand,
                onPickImages: _pickImages,
                onPickFiles: _pickFiles,
                onRemoveImage: (index) =>
                    setState(() => _pendingImages.removeAt(index)),
                onSend: _send,
                onSendFollowUp: () => _send(queueMode: 'followUp'),
                onStop: chat.stop,
                onPlanMode: _setPlanMode,
                onGoalMode: _setGoalMode,
                onUseCommand: _useCommand,
                onReferenceSession: _referenceSession,
                atQuery: _atQuery,
                atMatches: _atMatches,
                hashQuery: _hashQuery,
                hashMatches: _hashMatches,
                onApplyAt: _applyAtMatch,
                onApplyHash: _applyHashMatch,
              ),
            ],
          );
          if (constraints.maxWidth < 600) return chatColumn;
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                width: 300,
                child: _SessionDrawer(
                  embedded: true,
                  controller: chat,
                  onNewChat: _startNewChat,
                  onOpen: (session) => chat.openSession(session),
                  onDelete: _confirmDeleteSession,
                  onLogout: widget.onLogout,
                  onSwitchServer: widget.onSwitchServer == null
                      ? null
                      : () => _showServerSwitcher(context),
                  onSwitchProject: _switchProject,
                ),
              ),
              const VerticalDivider(width: 1, thickness: 1),
              Expanded(child: chatColumn),
            ],
          );
        },
      ),
    );
  }

  Widget _conversation() {
    if (chat.loadingMessages) {
      return const Center(child: CircularProgressIndicator());
    }
    if (chat.messages.isEmpty && chat.streamingMessage == null) {
      return _EmptyChat(cwd: chat.draftCwd, onNew: _chooseNewChat);
    }
    final items = _conversationItems();
    return _FineControlScrollbar(
      controller: _scrollController,
      thumbColor: Theme.of(
        context,
      ).colorScheme.onSurfaceVariant.withValues(alpha: .55),
      child: ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.fromLTRB(16, 14, 22, 24),
        itemCount: items.length,
        itemBuilder: (context, index) => items[index],
      ),
    );
  }

  List<Widget> _conversationItems() {
    final result = <Widget>[];
    final messages = chat.messages;
    var compactLiveTail = false;
    var compactProcessMessages = 0;
    var compactToolCalls = 0;
    var index = 0;
    while (index < messages.length) {
      final message = messages[index];
      if (message.role != 'user') {
        // 散落的非用户消息（无 user 前缀或 user 已被消费）：
        // 收集连续的非 user 消息进过程组（横向小块），避免每行一个。
        final orphanProcess = <ChatMessage>[];
        var orphanToolCount = 0;
        while (index < messages.length && messages[index].role != 'user') {
          final m = messages[index];
          if (_hasDisplayableContent(m)) {
            orphanProcess.add(m);
            orphanToolCount += m.toolCallCount;
          }
          index += 1;
        }
        if (orphanProcess.isNotEmpty) {
          result.add(
            _ProcessDetailsGroup(
              processMessages: orphanProcess,
              messageCount: orphanProcess.length,
              toolCallCount: orphanToolCount,
              defaultExpanded: !chat.running,
              onLoadThinking: _loadThinking,
              thinkingVertical: !widget.compactOutput,
            displayMode: _processDisplayMode,
            ),
          );
        }
        continue;
      }

      result.add(
        _MessageBubble(
          message: message,
          onLoadThinking: _loadThinking,
          onFork: _forkFrom,
          thinkingVertical: !widget.compactOutput,
        ),
      );
      var end = index + 1;
      while (end < messages.length && messages[end].role != 'user') {
        end += 1;
      }
      final liveTail = chat.running && end == messages.length;
      if (liveTail) {
        // While the run is active the live working panel renders the
        // real-time tool steps, thinking and streamed text; historical
        // process messages stay visible after the run settles inside the
        // collapsible process group (same as the web client).
        compactLiveTail = true;
        for (var current = index + 1; current < end; current++) {
          if (_hasDisplayableContent(messages[current])) {
            compactProcessMessages += 1;
            compactToolCalls += messages[current].toolCallCount;
          }
        }
        index = end;
        continue;
      }

      var finalAnswer = -1;
      for (var current = end - 1; current > index; current--) {
        final candidate = messages[current];
        if (candidate.role == 'assistant' && candidate.text.trim().isNotEmpty) {
          finalAnswer = current;
          break;
        }
      }
      if (finalAnswer < 0) {
        final noAnswerProcess = <ChatMessage>[];
        var noAnswerToolCount = 0;
        for (var current = index + 1; current < end; current++) {
          final m = messages[current];
          if (_hasDisplayableContent(m)) {
            noAnswerProcess.add(m);
            noAnswerToolCount += m.toolCallCount;
          }
        }
        if (noAnswerProcess.isNotEmpty) {
          result.add(
            _ProcessDetailsGroup(
              processMessages: noAnswerProcess,
              messageCount: noAnswerProcess.length,
              toolCallCount: noAnswerToolCount,
              defaultExpanded: !chat.running,
              onLoadThinking: _loadThinking,
              thinkingVertical: !widget.compactOutput,
            displayMode: _processDisplayMode,
            ),
          );
        }
        index = end;
        continue;
      }

      final processMessages = <ChatMessage>[];
      var processMessageCount = 0;
      var toolCallCount = 0;
      for (var current = index + 1; current < finalAnswer; current++) {
        final process = messages[current];
        if (_hasDisplayableContent(process)) {
          processMessages.add(process);
          processMessageCount += 1;
          toolCallCount += process.toolCallCount;
        }
      }
      final answer = messages[finalAnswer];
      if (answer.thinking.isNotEmpty || answer.processText.isNotEmpty) {
        processMessages.add(answer.copyWith(text: ''));
        processMessageCount += 1;
        toolCallCount += answer.toolCallCount;
      }
      // finalAnswer 之后的残留过程消息（如多轮工具调用）：并入同一过程组
      for (var current = finalAnswer + 1; current < end; current++) {
        final m = messages[current];
        if (_hasDisplayableContent(m)) {
          processMessages.add(m);
          processMessageCount += 1;
          toolCallCount += m.toolCallCount;
        }
      }
      if (processMessages.isNotEmpty) {
        result.add(
          _ProcessDetailsGroup(
            processMessages: processMessages,
            messageCount: processMessageCount,
            toolCallCount: toolCallCount,
            // 默认展开 tabs 块状步骤（对齐网页端 ProcessGroup 展开态）
            defaultExpanded: !chat.running,
            onLoadThinking: _loadThinking,
            thinkingVertical: !widget.compactOutput,
            displayMode: _processDisplayMode,
          ),
        );
      }
      result.add(
        _MessageBubble(
          message: answer.copyWith(thinking: '', processText: ''),
          onLoadThinking: _loadThinking,
          onFork: _forkFrom,
              thinkingVertical: !widget.compactOutput,
        ),
      );
      index = end;
    }
    final streaming = chat.streamingMessage;
    final hasLiveWork =
        chat.running &&
        (compactLiveTail || streaming != null || chat.liveToolSteps.isNotEmpty);
    if (hasLiveWork) {
      if (streaming != null && _hasDisplayableContent(streaming)) {
        compactProcessMessages += 1;
        compactToolCalls += streaming.toolCallCount;
      }
      result.add(
        _LiveProcessPanel(
          phase: chat.agentPhase,
          toolSteps: List<LiveToolStep>.of(chat.liveToolSteps),
          thinking: streaming?.thinking ?? '',
          streamingText: streaming?.text ?? '',
          showStreamingText: !widget.compactOutput,
          thinkingVertical: !widget.compactOutput,
          messageCount: compactProcessMessages,
          toolCallCount: compactToolCalls,
        ),
      );
    } else if (streaming != null) {
      result.add(
        _MessageBubble(
          message: streaming,
          streaming: true,
          onLoadThinking: _loadThinking,
        ),
      );
    }
    return result;
  }

  bool _hasDisplayableContent(ChatMessage message) =>
      message.text.trim().isNotEmpty ||
      message.thinking.isNotEmpty ||
      message.processText.isNotEmpty;

  /// Fetches deferred thinking for a message and updates it in place so the
  /// loaded text renders without rebuilding the whole list.
  Future<void> _loadThinking(ChatMessage message) async {
    final entryId = message.thinkingEntryId;
    final blockIndex = message.thinkingBlockIndex;
    final sessionId = chat.activeSessionId;
    if (entryId == null || blockIndex == null || sessionId == null) return;
    String thinking;
    try {
      thinking = await chat.api.getEntryThinking(
        sessionId,
        entryId,
        blockIndex,
      );
    } catch (cause) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorTextForThinking(cause))));
      }
      return;
    }
    if (thinking.trim().isEmpty || !mounted) return;
    chat.updateMessageThinking(message, thinking);
  }

  String _errorTextForThinking(Object cause) {
    final text = cause.toString().replaceFirst('PiApiException: ', '');
    return context.tr('思考过程加载失败：{error}', {'error': text});
  }

  /// 从指定消息分叉（fork）：以该消息 entryId 创建新会话并跳转。
  Future<void> _forkFrom(ChatMessage message) async {
    final sessionId = chat.activeSessionId;
    final entryId = message.entryId;
    if (sessionId == null || entryId == null || entryId.isEmpty) return;
    try {
      final newId = await chat.api.forkSession(sessionId, entryId);
      if (newId == null || !mounted) return;
      // fork 后会话列表刷新，并跳转到新会话
      await chat.refreshSessions();
      final target = chat.sessions
          .where((session) => session.id == newId)
          .firstOrNull;
      if (target != null && mounted) {
        await chat.openSession(target);
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('已从该消息分叉出新会话'))),
        );
      }
    } catch (cause) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorTextForThinking(cause))));
      }
    }
  }
}

class _FineControlScrollbar extends RawScrollbar {
  const _FineControlScrollbar({
    required super.controller,
    required super.child,
    required Color super.thumbColor,
  }) : super(
         thumbVisibility: true,
         interactive: true,
         thickness: 4,
         radius: const Radius.circular(8),
         crossAxisMargin: 22,
         pressDuration: Duration.zero,
       );

  @override
  RawScrollbarState<_FineControlScrollbar> createState() =>
      _FineControlScrollbarState();
}

class _FineControlScrollbarState
    extends RawScrollbarState<_FineControlScrollbar> {
  static const _draggedThickness = 12.0;
  static const _fullSpeedDistance = 220.0;
  static const _minimumSensitivity = .28;

  Offset? _dragStart;
  bool _dragging = false;

  Offset _adjustedPosition(Offset position) {
    final start = _dragStart;
    if (start == null) return position;
    final direction = getScrollbarDirection();
    if (direction == null) return position;
    final delta = direction == Axis.vertical
        ? position.dy - start.dy
        : position.dx - start.dx;
    final progress = (delta.abs() / _fullSpeedDistance).clamp(0.0, 1.0);
    final sensitivity =
        _minimumSensitivity + (1 - _minimumSensitivity) * progress * progress;
    final adjustedDelta = delta * sensitivity;
    return direction == Axis.vertical
        ? Offset(position.dx, start.dy + adjustedDelta)
        : Offset(start.dx + adjustedDelta, position.dy);
  }

  @override
  void updateScrollbarPainter() {
    super.updateScrollbarPainter();
    scrollbarPainter.thickness = _dragging
        ? _draggedThickness
        : widget.thickness!;
  }

  @override
  void handleThumbPressStart(Offset localPosition) {
    _dragStart = localPosition;
    super.handleThumbPressStart(localPosition);
    setState(() => _dragging = true);
  }

  @override
  void handleThumbPressUpdate(Offset localPosition) {
    super.handleThumbPressUpdate(_adjustedPosition(localPosition));
  }

  @override
  void handleThumbPressEnd(Offset localPosition, Velocity velocity) {
    super.handleThumbPressEnd(_adjustedPosition(localPosition), Velocity.zero);
    _dragStart = null;
    setState(() => _dragging = false);
  }
}

class _RoundToolbarButton extends StatefulWidget {
  const _RoundToolbarButton({
    super.key,
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  State<_RoundToolbarButton> createState() => _RoundToolbarButtonState();
}

class _RoundToolbarButtonState extends State<_RoundToolbarButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return Tooltip(
      message: widget.tooltip,
      child: Center(
        child: SizedBox.square(
          dimension: 48,
          child: AnimatedScale(
            scale: _pressed && !reduceMotion ? .97 : 1,
            duration: reduceMotion
                ? Duration.zero
                : const Duration(milliseconds: 120),
            curve: Curves.easeOut,
            child: Material(
              color: Theme.of(context).colorScheme.surfaceContainerHigh,
              shape: const CircleBorder(),
              child: InkWell(
                onTap: widget.onPressed,
                onHighlightChanged: (pressed) =>
                    setState(() => _pressed = pressed),
                customBorder: const CircleBorder(),
                child: Center(child: Icon(widget.icon)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PendingImage {
  const _PendingImage({required this.bytes, required this.attachment});

  final Uint8List bytes;
  final PiImageAttachment attachment;
}

class _ImagePreview extends StatelessWidget {
  const _ImagePreview({required this.image, required this.onRemove});

  final _PendingImage image;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 200),
      curve: const Cubic(.23, 1, .32, 1),
      builder: (context, progress, child) => Transform.scale(
        scale: reduceMotion ? 1 : .95 + (.05 * progress),
        alignment: Alignment.bottomLeft,
        child: Opacity(opacity: progress, child: child),
      ),
      child: SizedBox(
        width: 72,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned.fill(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Image.memory(
                  image.bytes,
                  fit: BoxFit.cover,
                  // Decode at a small size; the preview is only 72 px wide.
                  // Without this the full-resolution image is decoded on every
                  // rebuild, which is both slow and memory-heavy.
                  cacheWidth: 144,
                ),
              ),
            ),
            Positioned(
              right: -5,
              top: -5,
              child: Material(
                color: Theme.of(context).colorScheme.inverseSurface,
                shape: const CircleBorder(),
                child: InkWell(
                  onTap: onRemove,
                  customBorder: const CircleBorder(),
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: Icon(
                      Icons.close_rounded,
                      size: 15,
                      color: Theme.of(context).colorScheme.onInverseSurface,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat({required this.cwd, required this.onNew});
  final String? cwd;
  final VoidCallback onNew;

  @override
  Widget build(BuildContext context) {
    if (cwd != null) return const SizedBox.expand();
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          children: [
            Container(
              width: 58,
              height: 58,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xff0a84ff), Color(0xff5e5ce6)],
                ),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.terminal_rounded,
                color: Colors.white,
                size: 30,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              context.tr('今天想让 Pi 做什么？'),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(
              context.tr('先创建一个对话并选择远端工作目录'),
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: onNew,
              icon: const Icon(Icons.add),
              label: Text(context.tr('新建对话')),
            ),
          ],
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.message,
    this.streaming = false,
    this.onLoadThinking,
    this.onFork,
    this.thinkingVertical = false,
  });
  final ChatMessage message;
  final bool streaming;

  /// Fetches deferred thinking for [message]. When null, thinking is only
  /// shown if already loaded.
  final Future<void> Function(ChatMessage message)? onLoadThinking;

  /// Fork 回调：以本条消息为分支点创建新会话（网页端「分叉」）。
  final Future<void> Function(ChatMessage message)? onFork;

  /// 竖向显示形式下思考连续显示（网页端 ProcessNarrative）。
  final bool thinkingVertical;

  /// Caps bubble width so iPad landscape and wide windows keep readable lines.
  /// Width scales with the screen up to a fixed ceiling.
  double _bubbleMaxWidth(BuildContext context, bool user) {
    final screenWidth = MediaQuery.sizeOf(context).width;
    // Match the web client: user bubble min(85%, 680px), assistant full width.
    final ratio = user ? .85 : 1.0;
    final ceiling = user ? 680.0 : double.infinity;
    final scaled = screenWidth * ratio;
    return scaled > ceiling ? ceiling : scaled;
  }

  @override
  Widget build(BuildContext context) {
    final user = message.role == 'user';
    final tool =
        message.role == 'toolResult' ||
        message.role == 'bashExecution' ||
        message.role == 'status';
    final isError = message.isError ||
        message.text.startsWith('模型请求失败：') ||
        message.text.startsWith('Model request failed:');
    if (message.text.trim().isEmpty &&
        message.thinking.isEmpty &&
        message.processText.isEmpty &&
        !streaming) {
      return const SizedBox.shrink();
    }
    return GestureDetector(
      onLongPress: (message.text.isNotEmpty || onFork != null)
          ? () => _showMessageActions(context, user)
          : null,
      child: Align(
        alignment: user ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          constraints: BoxConstraints(maxWidth: _bubbleMaxWidth(context, user)),
        margin: const EdgeInsets.symmetric(vertical: 6),
        // Web client: user bubble padding 9×14; tool cards keep a tighter pad.
        padding: EdgeInsets.symmetric(
          horizontal: user ? 14 : (tool ? 10 : 0),
          vertical: user ? 9 : 12,
        ),
        decoration: BoxDecoration(
          color: isError
              ? Theme.of(
                  context,
                ).colorScheme.error.withValues(alpha: .12)
              : user
              ? (Theme.of(context).extension<PiWebColors>()?.accentGhost ??
                    (Theme.of(context).brightness == Brightness.dark
                        ? const Color(0xff1e2a2b)
                        : const Color(0xffeff6ff)))
              : tool
              ? (Theme.of(context).extension<PiWebColors>()?.toolBg ??
                    (Theme.of(context).brightness == Brightness.dark
                        ? const Color(0xff171c1c)
                        : const Color(0xfff9fafb)))
              : Colors.transparent,
          // MonkeyCode-style asymmetric user bubble: 16 with a 5px bottom-right.
          borderRadius: isError
              ? BorderRadius.circular(AppleRadius.md)
              : user
              ? const BorderRadius.only(
                  topLeft: Radius.circular(16),
                  topRight: Radius.circular(16),
                  bottomLeft: Radius.circular(16),
                  bottomRight: Radius.circular(5),
                )
              : BorderRadius.circular(tool ? 13 : 18),
          border: isError
              ? Border.all(
                  color: Theme.of(context).colorScheme.error.withValues(
                    alpha: .5,
                  ),
                )
              : user
              ? Border.all(
                  color:
                      Theme.of(context).extension<PiWebColors>()?.accentLine ??
                      Theme.of(context).dividerColor,
                )
              : tool
              ? Border.all(color: Theme.of(context).dividerColor)
              : null,
          boxShadow: tool ? AppleShadows.card : null,
        ),
        child:
            message.text.isEmpty &&
                message.thinking.isEmpty &&
                message.processText.isEmpty &&
                streaming
            ? const _TypingIndicator()
            : ConstrainedBox(
                // Web client caps the user bubble at 300px with internal scroll.
                constraints: user
                    ? const BoxConstraints(maxHeight: 300)
                    : const BoxConstraints(),
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (message.queued) ...[
                        Align(
                          alignment: user
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 5),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 7,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: Theme.of(
                                context,
                              ).colorScheme.primary.withValues(alpha: .12),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.hourglass_top_rounded,
                                  size: 12,
                                  color: Theme.of(context).colorScheme.primary,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  context.tr('已排队，将在当前运行后处理'),
                                  style: Theme.of(context).textTheme.labelSmall
                                      ?.copyWith(
                                        color: Theme.of(
                                          context,
                                        ).colorScheme.primary,
                                      ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 2),
                      ],
                      if (message.thinking.isNotEmpty)
                        _ThinkingSection(
                          thinking: message.thinking,
                          streaming: streaming,
                          vertical: thinkingVertical,
                        )
                      else if (message.thinkingEntryId != null &&
                          message.thinkingBlockIndex != null)
                        _DeferredThinkingButton(
                          onLoad: () async {
                            final callback = onLoadThinking;
                            if (callback == null) return;
                            await callback(message);
                          },
                        ),
                      if ((message.thinking.isNotEmpty ||
                              (message.thinkingEntryId != null &&
                                  message.thinkingBlockIndex != null)) &&
                          (message.processText.isNotEmpty ||
                              message.text.isNotEmpty ||
                              message.toolCalls.isNotEmpty))
                        const SizedBox(height: 8),
                      if (message.toolCalls.isNotEmpty) ...[
                        for (final toolCall in message.toolCalls)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: _ToolCallCard(
                              name: toolCall.name,
                              arguments: toolCall.arguments,
                              running: false,
                              isError: false,
                              resultText: null,
                              duration: null,
                            ),
                          ),
                        const SizedBox(height: 2),
                      ],
                      if (message.processText.isNotEmpty)
                        MarkdownBody(
                          data: message.processText,
                          selectable: true,
                          styleSheet:
                              MarkdownStyleSheet.fromTheme(
                                Theme.of(context),
                              ).copyWith(
                                p: Theme.of(context).textTheme.bodyMedium
                                    ?.copyWith(
                                      color: Theme.of(
                                        context,
                                      ).colorScheme.onSurfaceVariant,
                                    ),
                              ),
                        ),
                      if (message.processText.isNotEmpty &&
                          message.text.isNotEmpty)
                        const SizedBox(height: 8),
                      if (message.text.isNotEmpty)
                        isError
                        ? ConstrainedBox(
                            constraints: const BoxConstraints(maxHeight: 180),
                            child: SingleChildScrollView(
                              child: MarkdownBody(
                                data: message.text,
                                selectable: true,
                                styleSheet:
                                    MarkdownStyleSheet.fromTheme(
                                      Theme.of(context),
                                    ).copyWith(
                                      p: Theme.of(
                                        context,
                                      ).textTheme.bodyLarge?.copyWith(
                                        height: 1.7,
                                        color: Theme.of(
                                          context,
                                        ).colorScheme.error,
                                      ),
                                    ),
                              ),
                            ),
                          )
                        : MarkdownBody(
                            data: message.text,
                            selectable: true,
                            styleSheet:
                                MarkdownStyleSheet.fromTheme(
                                  Theme.of(context),
                                ).copyWith(
                                  p: Theme.of(
                                    context,
                                  ).textTheme.bodyLarge?.copyWith(height: 1.7),
                                  codeblockDecoration: BoxDecoration(
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  codeblockPadding: const EdgeInsets.all(12),
                                ),
                          ),
                    ],
                  ),
                ),
              ),
      ),
      ),
    );
  }

  /// 消息长按操作：复制 / 从这条消息分叉（fork）。
  Future<void> _showMessageActions(BuildContext context, bool user) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (message.text.isNotEmpty)
              ListTile(
                leading: const Icon(Icons.copy_all_outlined),
                title: Text(context.tr('复制')),
                onTap: () => Navigator.of(sheetContext).pop('copy'),
              ),
            if (onFork != null)
              ListTile(
                leading: const Icon(Icons.call_split),
                title: Text(context.tr('从此消息分叉')),
                onTap: () => Navigator.of(sheetContext).pop('fork'),
              ),
          ],
        ),
      ),
    );
    switch (action) {
      case 'copy':
        await showCopySheet(
          context,
          text: message.text,
          title: user ? context.tr('复制消息') : context.tr('复制回复'),
        );
      case 'fork':
        await onFork?.call(message);
    }
  }
}

class _ProcessDetailsGroup extends StatefulWidget {
  const _ProcessDetailsGroup({
    required this.processMessages,
    required this.messageCount,
    required this.toolCallCount,
    this.defaultExpanded = false,
    this.onLoadThinking,
    this.thinkingVertical = false,
    this.displayMode = 'tabs',
  });

  /// 中间过程消息（工具调用/思考/过程文本）。
  final List<ChatMessage> processMessages;
  final int messageCount;
  final int toolCallCount;

  /// 竖向显示形式下默认展开（网页端 ProcessGroup 展开即完整过程）。
  final bool defaultExpanded;
  final Future<void> Function(ChatMessage message)? onLoadThinking;
  final bool thinkingVertical;

  /// 显示模式（由聊天页顶部按钮全局控制）：'tabs' 横向块状 | 'timeline' 树形。
  final String displayMode;

  @override
  State<_ProcessDetailsGroup> createState() => _ProcessDetailsGroupState();
}

class _LiveProcessPanel extends StatefulWidget {
  const _LiveProcessPanel({
    required this.phase,
    required this.toolSteps,
    required this.thinking,
    required this.streamingText,
    required this.showStreamingText,
    required this.messageCount,
    required this.toolCallCount,
    this.thinkingVertical = false,
  });

  /// 'waiting_model' | 'running_command' | 'running_tools' | null.
  final String? phase;
  final List<LiveToolStep> toolSteps;
  final String thinking;
  final String streamingText;
  final bool showStreamingText;
  final int messageCount;
  final int toolCallCount;

  /// 竖向显示形式下思考连续显示（网页端 ProcessNarrative）。
  final bool thinkingVertical;

  @override
  State<_LiveProcessPanel> createState() => _LiveProcessPanelState();
}

class _LiveProcessPanelState extends State<_LiveProcessPanel> {
  int _activeStep = 0;

  @override
  void didUpdateWidget(covariant _LiveProcessPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 新步骤到达时自动选中最后一个（对齐网页端 activeTab 跟随最新步骤）
    if (oldWidget.toolSteps.length != widget.toolSteps.length &&
        widget.toolSteps.isNotEmpty) {
      _activeStep = widget.toolSteps.length - 1;
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final toolSteps = widget.toolSteps;
    final thinking = widget.thinking;
    final streamingText = widget.streamingText;
    final phase = widget.phase;
    final runningNames = toolSteps
        .where((step) => step.running)
        .map((step) => step.name)
        .take(3)
        .toList();
    final phaseText = switch (phase) {
      'waiting_model' => context.tr('等待模型'),
      'running_command' => context.tr('运行命令'),
      'running_tools' when runningNames.isNotEmpty => context.tr(
        '正在运行工具: {names}',
        {'names': runningNames.join(', ')},
      ),
      _ => <String>[
        context.tr('Pi 正在处理'),
        if (widget.messageCount > 0)
          context.tr('{count} 个步骤', {'count': widget.messageCount}),
        if (widget.toolCallCount > 0)
          context.tr('{count} 个工具调用', {'count': widget.toolCallCount}),
      ].join(' · '),
    };
    if (_activeStep >= toolSteps.length) {
      _activeStep = toolSteps.length - 1;
    }
    final activeStep = toolSteps.isEmpty ? null : toolSteps[_activeStep];

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const SizedBox.square(
                dimension: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  phaseText,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                ),
              ),
            ],
          ),
          // ── 工具步骤：横向小块排列（对齐网页端 process-tab）──
          if (toolSteps.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (var index = 0; index < toolSteps.length; index++)
                  _buildStepTab(context, toolSteps[index], index),
              ],
            ),
            if (activeStep != null) ...[
              const SizedBox(height: 8),
              _ToolCallCard(
                name: activeStep.name,
                arguments: activeStep.arguments,
                running: activeStep.running,
                isError: activeStep.isError,
                resultText: activeStep.resultText,
                duration: activeStep.duration,
              ),
            ],
          ],
          if (thinking.trim().isNotEmpty) ...[
            const SizedBox(height: 8),
            _ThinkingSection(
              thinking: thinking,
              streaming: true,
              vertical: widget.thinkingVertical,
            ),
          ],
          if (widget.showStreamingText && streamingText.trim().isNotEmpty) ...[
            const SizedBox(height: 8),
            _StreamingText(data: streamingText),
          ],
        ],
      ),
    );
  }

  /// 横向小块（网页端 process-tab）：active 高亮、错误红色、运行呼吸。
  Widget _buildStepTab(BuildContext context, LiveToolStep step, int index) {
    final cs = Theme.of(context).colorScheme;
    final isActive = _activeStep == index;
    final isError = step.isError;
    final running = step.running;
    return Material(
      color: isError
          ? cs.error.withValues(alpha: .08)
          : isActive
          ? cs.primary.withValues(alpha: .14)
          : cs.onSurface.withValues(alpha: .05),
      borderRadius: BorderRadius.circular(4),
      child: InkWell(
        borderRadius: BorderRadius.circular(4),
        onTap: () => setState(() => _activeStep = index),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                _toolIconFor(step.name),
                size: 11,
                color: isError
                    ? cs.error
                    : isActive
                    ? cs.primary
                    : cs.onSurfaceVariant,
              ),
              const SizedBox(width: 3),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 110),
                child: Text(
                  step.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    height: 1.2,
                    color: isError
                        ? cs.error
                        : isActive
                        ? cs.primary
                        : cs.onSurfaceVariant,
                  ),
                ),
              ),
              if (running) ...[
                const SizedBox(width: 3),
                SizedBox.square(
                  dimension: 8,
                  child: CircularProgressIndicator(strokeWidth: 1.5),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  IconData _toolIconFor(String name) {
    final n = name.toLowerCase();
    if (n.contains('bash') || n.contains('shell') || n.contains('exec')) {
      return Icons.terminal_rounded;
    }
    if (n.contains('read') || n.contains('grep') || n.contains('search')) {
      return Icons.search_rounded;
    }
    if (n.contains('write') || n.contains('edit') || n.contains('patch')) {
      return Icons.edit_rounded;
    }
    if (n.contains('web') || n.contains('fetch') || n.contains('http')) {
      return Icons.public_rounded;
    }
    if (n.contains('file') || n.contains('ls')) {
      return Icons.folder_outlined;
    }
    return Icons.handyman_outlined;
  }
}

/// Collapsible tool card mirroring the web client's ToolCallBlock: monospace
/// name + single-line argument preview + duration + status colour, expanding
/// to the full JSON arguments and result text.
class _ToolCallCard extends StatefulWidget {
  const _ToolCallCard({
    required this.name,
    required this.arguments,
    required this.running,
    required this.isError,
    required this.resultText,
    required this.duration,
  });

  final String name;
  final Map<String, dynamic>? arguments;
  final bool running;
  final bool isError;
  final String? resultText;
  final Duration? duration;

  @override
  State<_ToolCallCard> createState() => _ToolCallCardState();
}

class _ToolCallCardState extends State<_ToolCallCard> {
  bool _expanded = false;

  String _preview() =>
      PiToolCall(name: widget.name, arguments: widget.arguments).preview;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final ts = Theme.of(context).textTheme;
    final duration = widget.duration;
    final seconds = duration == null
        ? null
        : (duration.inMilliseconds / 1000).toStringAsFixed(1);
    final borderColor = widget.running
        ? cs.outlineVariant
        : widget.isError
        ? cs.error.withValues(alpha: .55)
        : const Color(0x5934c759); // success green, 35% alpha
    final motionDuration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 200);
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerLow,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: borderColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: Row(
                children: [
                  if (widget.running)
                    const SizedBox.square(
                      dimension: 13,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  else
                    Icon(
                      widget.isError
                          ? Icons.error_rounded
                          : Icons.check_circle_rounded,
                      size: 15,
                      color: widget.isError
                          ? cs.error
                          : (Theme.of(
                                  context,
                                ).extension<PiWebColors>()?.green ??
                                const Color(0xff34c759)),
                    ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      widget.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: widget.isError ? cs.error : null,
                      ),
                    ),
                  ),
                  if (_preview().isNotEmpty) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _preview(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: ts.bodySmall?.copyWith(
                          color: cs.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                  if (seconds != null) ...[
                    const SizedBox(width: 8),
                    Text(
                      '${seconds}s',
                      style: ts.bodySmall?.copyWith(
                        color: cs.outline,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                  const SizedBox(width: 4),
                  AnimatedRotation(
                    turns: _expanded ? .25 : 0,
                    duration: motionDuration,
                    curve: Curves.easeOutQuart,
                    child: const Icon(Icons.chevron_right, size: 16),
                  ),
                ],
              ),
            ),
          ),
          AnimatedSize(
            duration: motionDuration,
            curve: Curves.easeOutQuart,
            child: _expanded
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Divider(height: 1),
                        if (widget.arguments != null &&
                            widget.arguments!.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(
                            context.tr('输入参数'),
                            style: ts.labelSmall?.copyWith(
                              color: cs.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 4),
                          _MonoBlock(
                            text: const JsonEncoder.withIndent(
                              '  ',
                            ).convert(widget.arguments),
                          ),
                        ],
                        if (widget.resultText != null) ...[
                          const SizedBox(height: 8),
                          Text(
                            context.tr('结果'),
                            style: ts.labelSmall?.copyWith(
                              color: cs.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 4),
                          _MonoBlock(
                            text: widget.resultText!,
                            color: widget.isError ? cs.error : null,
                          ),
                        ],
                      ],
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

/// Monospace preformatted block for JSON arguments / tool output.
class _MonoBlock extends StatelessWidget {
  const _MonoBlock({required this.text, this.color});
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontFamily: 'monospace',
          fontSize: 12,
          height: 1.45,
          color: color ?? cs.onSurfaceVariant,
        ),
      ),
    );
  }
}

/// Streamed assistant text shown while the run is active (compact output off).
class _StreamingText extends StatelessWidget {
  const _StreamingText({required this.data});
  final String data;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(14),
      ),
      child: MarkdownBody(
        data: data,
        selectable: true,
        styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
          p: Theme.of(context).textTheme.bodyMedium?.copyWith(height: 1.6),
        ),
      ),
    ),
  );
}

/// 过程中的一个步骤（对齐网页端 ProcessGroup 的 Step 概念）。
class _ProcessStep {
  const _ProcessStep({
    required this.id,
    required this.label,
    required this.icon,
    this.thinking = '',
    this.processText = '',
    this.toolCalls = const [],
    this.isError = false,
  });

  final String id;
  final String label;
  final IconData icon;
  final String thinking;
  final String processText;
  final List<PiToolCall> toolCalls;
  final bool isError;

  bool get hasContent =>
      thinking.isNotEmpty || processText.isNotEmpty || toolCalls.isNotEmpty;
}

class _ProcessDetailsGroupState extends State<_ProcessDetailsGroup> {
  late bool _expanded = widget.defaultExpanded;
  bool _userToggled = false;
  int _activeTab = 0;
  final Set<String> _openSteps = {};
  List<_ProcessStep> _steps = const [];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // context.tr 依赖 InheritedWidget，只能在挂载后调用
    _buildSteps();
  }

  @override
  void didUpdateWidget(covariant _ProcessDetailsGroup oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.processMessages != widget.processMessages) {
      _buildSteps();
      _activeTab = 0;
    }
    // 运行状态变化（defaultExpanded 由 !chat.running 驱动）：
    // 仅在用户未手动展开/折叠时跟随默认值
    if (oldWidget.defaultExpanded != widget.defaultExpanded &&
        !_userToggled) {
      _expanded = widget.defaultExpanded;
    }
  }

  /// 从过程消息构建步骤（对齐网页端 buildProcessSteps）：
  /// 思考消息合并为一个「思考」步骤；工具调用每个一个步骤；文本步骤。
  void _buildSteps() {
    final steps = <_ProcessStep>[];
    String pendingThinking = '';
    final pendingMessages = <ChatMessage>[];

    void flushThinking() {
      if (pendingThinking.isEmpty) return;
      steps.add(
        _ProcessStep(
          id: 'thinking-${steps.length}',
          label: context.tr('思考过程'),
          icon: Icons.psychology_outlined,
          thinking: pendingThinking,
          isError: pendingMessages.any((m) => m.isError),
        ),
      );
      pendingThinking = '';
      pendingMessages.clear();
    }

    for (final message in widget.processMessages) {
      if (message.thinking.isNotEmpty) {
        pendingThinking = [pendingThinking, message.thinking]
            .where((s) => s.isNotEmpty)
            .join('\n\n');
        pendingMessages.add(message);
        continue;
      }
      if (message.toolCalls.isNotEmpty) {
        flushThinking();
        for (final toolCall in message.toolCalls) {
          steps.add(
            _ProcessStep(
              id: 'tool-${steps.length}',
              label: toolCall.name,
              icon: _toolIcon(toolCall.name),
              toolCalls: [toolCall],
              isError: message.isError,
            ),
          );
        }
        continue;
      }
      if (message.processText.isNotEmpty) {
        flushThinking();
        steps.add(
          _ProcessStep(
            id: 'text-${steps.length}',
            label: context.tr('过程'),
            icon: Icons.notes_rounded,
            processText: message.processText,
            isError: message.isError,
          ),
        );
      }
    }
    flushThinking();
    if (steps.isEmpty && widget.processMessages.isNotEmpty) {
      // 兜底：全部内容都无分类时，把每个消息作为文本步骤
      for (final message in widget.processMessages) {
        final text = [message.thinking, message.processText, message.text]
            .where((s) => s.isNotEmpty)
            .join('\n');
        if (text.isNotEmpty) {
          steps.add(
            _ProcessStep(
              id: 'fallback-${steps.length}',
              label: context.tr('过程'),
              icon: Icons.notes_rounded,
              processText: text,
              isError: message.isError,
            ),
          );
        }
      }
    }
    _steps = steps;
  }

  IconData _toolIcon(String name) {
    final n = name.toLowerCase();
    if (n.contains('read') || n.contains('grep') || n.contains('search')) {
      return Icons.search_rounded;
    }
    if (n.contains('write') || n.contains('edit') || n.contains('patch')) {
      return Icons.edit_rounded;
    }
    if (n.contains('bash') || n.contains('shell') || n.contains('exec')) {
      return Icons.terminal_rounded;
    }
    if (n.contains('web') || n.contains('fetch') || n.contains('http')) {
      return Icons.public_rounded;
    }
    if (n.contains('file') || n.contains('ls')) {
      return Icons.folder_outlined;
    }
    if (n.contains('delete') || n.contains('rm')) {
      return Icons.delete_outline;
    }
    return Icons.handyman_outlined;
  }

  @override
  Widget build(BuildContext context) {
    final motionDuration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 240);
    final details = <String>[
      context.tr('处理详情'),
      if (widget.toolCallCount > 0)
        context.tr('{count} 个工具调用', {'count': widget.toolCallCount}),
      if (_steps.any((s) => s.thinking.isNotEmpty))
        context.tr('{count} 个思考', {
          'count': _steps.where((s) => s.thinking.isNotEmpty).length,
        }),
    ].join(' · ');

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: TextButton.icon(
                  onPressed: () => setState(() {
                    _userToggled = true;
                    _expanded = !_expanded;
                  }),
                  style: TextButton.styleFrom(
                    foregroundColor:
                        Theme.of(context).colorScheme.onSurfaceVariant,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 4,
                      vertical: 2,
                    ),
                    minimumSize: const Size(0, 30),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  icon: AnimatedRotation(
                    turns: _expanded ? .25 : 0,
                    duration: motionDuration,
                    curve: Curves.easeOutQuart,
                    child: const Icon(Icons.chevron_right, size: 18),
                  ),
                  label: Text(details, style: const TextStyle(fontSize: 12)),
                ),
              ),
            ],
          ),
          AnimatedSize(
            duration: motionDuration,
            curve: Curves.easeOutQuart,
            child: _expanded ? _buildExpanded(context) : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }

  Widget _buildExpanded(BuildContext context) {
    final steps = _steps;
    if (steps.isEmpty) return const SizedBox.shrink();
    if (steps.length == 1 && steps.first.thinking.isNotEmpty) {
      // 单思考步骤：直接展开思考内容（竖向）。
      return Padding(
        padding: const EdgeInsets.only(top: 4),
        child: _StepContent(step: steps.first, widget: widget),
      );
    }
    if (widget.displayMode == 'tabs') {
      return _buildTabs(context);
    }
    return _buildTimeline(context);
  }

  /// tabs 模式：一行多个步骤块，点选显示内容（对齐网页端）。
  Widget _buildTabs(BuildContext context) {
    final steps = _steps;
    if (_activeTab >= steps.length) _activeTab = steps.length - 1;
    final active = steps[_activeTab];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (var index = 0; index < steps.length; index++)
                _buildTabChip(context, steps[index], index),
            ],
          ),
        ),
        Container(
          margin: const EdgeInsets.only(top: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: Theme.of(
              context,
            ).colorScheme.surfaceContainerLow.withValues(alpha: .6),
            borderRadius: BorderRadius.circular(12),
          ),
          child: _StepContent(step: active, widget: widget),
        ),
      ],
    );
  }

  Widget _buildTabChip(BuildContext context, _ProcessStep step, int index) {
    final cs = Theme.of(context).colorScheme;
    final isActive = _activeTab == index;
    final isError = step.isError;
    return Material(
      color: isActive
          ? (isError
              ? cs.error.withValues(alpha: .15)
              : cs.primary.withValues(alpha: .12))
          : cs.surfaceContainerHigh.withValues(alpha: .7),
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => setState(() => _activeTab = index),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                step.icon,
                size: 13,
                color: isError
                    ? cs.error
                    : isActive
                    ? cs.primary
                    : cs.onSurfaceVariant,
              ),
              const SizedBox(width: 4),
              Text(
                step.label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                  color: isError
                      ? cs.error
                      : isActive
                      ? cs.primary
                      : cs.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// timeline 模式：树状结构，每一步连接，点击展开内容（对齐网页端）。
  Widget _buildTimeline(BuildContext context) {
    final steps = _steps;
    return Padding(
      padding: const EdgeInsets.only(top: 8, left: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var index = 0; index < steps.length; index++)
            _buildTimelineStep(context, steps[index], index, steps.length),
        ],
      ),
    );
  }

  Widget _buildTimelineStep(
    BuildContext context,
    _ProcessStep step,
    int index,
    int total,
  ) {
    final cs = Theme.of(context).colorScheme;
    final open = _openSteps.contains(step.id);
    final isLast = index == total - 1;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 22,
            child: Column(
              children: [
                Icon(step.icon, size: 15, color: cs.onSurfaceVariant),
                if (!isLast)
                  Expanded(
                    child: Container(width: 1, color: cs.outlineVariant),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  InkWell(
                    borderRadius: BorderRadius.circular(6),
                    onTap: step.hasContent
                        ? () => setState(() {
                              if (open) {
                                _openSteps.remove(step.id);
                              } else {
                                _openSteps.add(step.id);
                              }
                            })
                        : null,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 3,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              step.label,
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w500,
                                color: step.isError
                                    ? cs.error
                                    : cs.onSurfaceVariant,
                              ),
                            ),
                          ),
                          if (step.hasContent)
                            AnimatedRotation(
                              turns: open ? .25 : 0,
                              duration: const Duration(milliseconds: 180),
                              child: Icon(
                                Icons.chevron_right,
                                size: 16,
                                color: cs.outline,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  if (open)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: _StepContent(step: step, widget: widget),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 单个步骤的内容区（思考 Markdown / 过程文本 / 工具卡片）。
class _StepContent extends StatelessWidget {
  const _StepContent({required this.step, required this.widget});

  final _ProcessStep step;
  final _ProcessDetailsGroup widget;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (step.thinking.isNotEmpty) ...[
          _ThinkingSection(
            thinking: step.thinking,
            streaming: false,
            vertical: true,
          ),
          const SizedBox(height: 6),
        ],
        if (step.toolCalls.isNotEmpty) ...[
          for (final toolCall in step.toolCalls)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: _ToolCallCard(
                name: toolCall.name,
                arguments: toolCall.arguments,
                running: false,
                isError: step.isError,
                resultText: null,
                duration: null,
              ),
            ),
          const SizedBox(height: 2),
        ],
        if (step.processText.isNotEmpty)
          MarkdownBody(
            data: step.processText,
            selectable: true,
            styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
              p: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: cs.onSurfaceVariant),
            ),
          ),
      ],
    );
  }
}

class _ThinkingSection extends StatelessWidget {
  const _ThinkingSection({
    required this.thinking,
    required this.streaming,
    this.vertical = false,
  });
  final String thinking;
  final bool streaming;

  /// true = 竖向串联（内容连续显示，不折叠）；false = 横向折叠条目。
  final bool vertical;

  @override
  Widget build(BuildContext context) {
    if (vertical) {
      // 竖向串联：思考内容直接连续显示，无折叠。
      return Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  Icons.psychology_outlined,
                  size: 15,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 6),
                Text(
                  context.tr(streaming ? '正在思考…' : '思考过程'),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(12),
              ),
              child: MarkdownBody(
                data: thinking,
                selectable: true,
                styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context))
                    .copyWith(
                      p: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        height: 1.45,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
              ),
            ),
          ],
        ),
      );
    }
    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        // Auto-expand while streaming so live reasoning is visible without a
        // tap; the web client behaves the same way.
        initiallyExpanded: streaming,
        tilePadding: const EdgeInsets.symmetric(horizontal: 12),
        childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        visualDensity: VisualDensity.compact,
        leading: Icon(
          Icons.psychology_outlined,
          size: 20,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
        title: Text(context.tr(streaming ? '正在思考…' : '思考过程')),
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: MarkdownBody(
              data: thinking,
              selectable: true,
              styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context))
                  .copyWith(
                    p: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      height: 1.45,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptySearchResult extends StatelessWidget {
  const _EmptySearchResult({required this.searching, required this.onClear});
  final bool searching;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              searching ? Icons.search_off_rounded : Icons.inbox_outlined,
              size: 34,
              color: Theme.of(context).colorScheme.outline,
            ),
            const SizedBox(height: 10),
            Text(
              context.tr(searching ? '没有找到匹配会话' : '暂无会话'),
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            if (searching) ...[
              const SizedBox(height: 10),
              TextButton(onPressed: onClear, child: Text(context.tr('清除搜索'))),
            ],
          ],
        ),
      ),
    );
  }
}

class _DeferredThinkingButton extends StatefulWidget {
  const _DeferredThinkingButton({required this.onLoad});
  final Future<void> Function() onLoad;

  @override
  State<_DeferredThinkingButton> createState() =>
      _DeferredThinkingButtonState();
}

class _DeferredThinkingButtonState extends State<_DeferredThinkingButton> {
  bool _loading = false;

  Future<void> _load() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      await widget.onLoad();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Material(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: _loading ? null : _load,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_loading)
                  const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else
                  Icon(
                    Icons.psychology_outlined,
                    size: 18,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                const SizedBox(width: 8),
                Text(
                  context.tr(_loading ? '正在加载思考过程…' : '加载思考过程'),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TypingIndicator extends StatelessWidget {
  const _TypingIndicator();
  @override
  Widget build(BuildContext context) => const SizedBox(
    width: 22,
    height: 22,
    child: CircularProgressIndicator(strokeWidth: 2),
  );
}

/// MonkeyCode-style session info bar: session name + model pill (tap to
/// switch) + context-usage ring + token count. Degrades gracefully when no
/// stats are available (shows only the model pill).
class _SessionInfoBar extends StatelessWidget {
  const _SessionInfoBar({required this.chat});

  final ChatController chat;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final hasSession = chat.activeSessionId != null;
    final sessionName = chat.selectedSession?.name;
    final contextUsage = (chat.maxContextTokens != null &&
            chat.maxContextTokens! > 0 &&
            chat.contextTokens != null)
        ? chat.contextTokens! / chat.maxContextTokens!
        : null;
    final tokens = chat.totalTokens;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 8),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        border: Border(
          bottom: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onLongPress: () {
                final id = chat.activeSessionId;
                if (id != null) {
                  Clipboard.setData(ClipboardData(text: id));
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(context.tr('已复制会话 ID'))),
                  );
                }
              },
              child: Text(
                hasSession && sessionName != null && sessionName.isNotEmpty
                    ? sessionName
                    : context.tr('新对话'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: scheme.onSurface,
                ),
              ),
            ),
          ),
          if (contextUsage != null) ...[
            const SizedBox(width: 8),
            ContextRing(
              percent: contextUsage,
              size: 24,
            ),
          ],
          if (tokens != null && tokens > 0) ...[
            const SizedBox(width: 6),
            Text(
              _formatTokens(tokens),
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 11,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }

  static String _formatTokens(int tokens) {
    if (tokens >= 1000000) {
      return '${(tokens / 1000000).toStringAsFixed(1)}M';
    }
    if (tokens >= 1000) {
      return '${(tokens / 1000).toStringAsFixed(1)}k';
    }
    return '$tokens';
  }
}

/// MonkeyCode-style running status row above the composer: spinner + label +
/// typing dots + live elapsed seconds.
class _GoalBanner extends StatelessWidget {
  const _GoalBanner({
    required this.status,
    required this.goalText,
    required this.elapsedSeconds,
    required this.onPause,
    required this.onResume,
    required this.onStop,
  });

  final String status;
  final String goalText;
  final int elapsedSeconds;
  final Future<void> Function() onPause;
  final Future<void> Function() onResume;
  final Future<void> Function() onStop;

  String _statusLabel(BuildContext context) => switch (status) {
    'running' => context.tr('运行中'),
    'paused' => context.tr('已暂停'),
    'blocked' => context.tr('受阻'),
    _ => status,
  };

  Color _statusColor(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return switch (status) {
      'paused' || 'blocked' => cs.error,
      _ => cs.primary,
    };
  }

  String _elapsedLabel() {
    final minutes = elapsedSeconds ~/ 60;
    final seconds = elapsedSeconds % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(12, 6, 12, 2),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: cs.primary.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cs.primary.withValues(alpha: .25)),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: _statusColor(context),
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _statusLabel(context),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: cs.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  goalText,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 2),
                Text(
                  context.tr('已运行 {time}', {'time': _elapsedLabel()}),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: cs.onSurfaceVariant,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
          if (status == 'running')
            IconButton(
              tooltip: context.tr('暂停'),
              icon: const Icon(Icons.pause_circle_outline, size: 20),
              onPressed: onPause,
            )
          else if (status == 'paused' || status == 'blocked')
            IconButton(
              tooltip: context.tr('继续'),
              icon: const Icon(Icons.play_circle_outline, size: 20),
              onPressed: onResume,
            ),
          IconButton(
            tooltip: context.tr('停止'),
            icon: Icon(Icons.stop_circle_outlined, size: 20, color: cs.error),
            onPressed: onStop,
          ),
        ],
      ),
    );
  }
}

class _Composer extends StatefulWidget {
  const _Composer({
    required this.controller,
    required this.running,
    required this.slashQuery,
    required this.slashCommands,
    required this.slashCommandsLoading,
    required this.dormantSkillNames,
    required this.slashViewCompact,
    required this.onToggleSlashView,
    required this.pendingImages,
    required this.onSlashCommand,
    required this.onPickImages,
    this.onPickFiles,
    required this.onRemoveImage,
    required this.onSend,
    this.onSendFollowUp,
    required this.onStop,
    this.onPlanMode,
    this.onGoalMode,
    this.onUseCommand,
    this.onReferenceSession,
    this.atQuery,
    this.atMatches = const [],
    this.hashQuery,
    this.hashMatches = const [],
    this.onApplyAt,
    this.onApplyHash,
  });
  final TextEditingController controller;
  final bool running;
  final String? slashQuery;
  final List<PiSlashCommand> slashCommands;
  final bool slashCommandsLoading;
  final Set<String> dormantSkillNames;
  final bool slashViewCompact;
  final VoidCallback onToggleSlashView;
  final List<_PendingImage> pendingImages;
  final ValueChanged<PiSlashCommand> onSlashCommand;
  final VoidCallback onPickImages;

  /// 任意文件上传（图片 + 文本注入），加号菜单「上传文件」入口。
  final VoidCallback? onPickFiles;
  final VoidCallback? onPlanMode;
  final VoidCallback? onGoalMode;
  final VoidCallback? onUseCommand;
  final VoidCallback? onReferenceSession;
  final ValueChanged<int> onRemoveImage;
  final VoidCallback onSend;

  /// Long-press on the send key while running: queue as follow-up (behind the
  /// current run) instead of steering.
  final VoidCallback? onSendFollowUp;
  final VoidCallback onStop;
  final String? atQuery;
  final List<String> atMatches;
  final String? hashQuery;
  final List<PiSnippet> hashMatches;
  final ValueChanged<String>? onApplyAt;
  final ValueChanged<PiSnippet>? onApplyHash;

  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  final _focusNode = FocusNode();

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  TextEditingController get controller => widget.controller;
  bool get running => widget.running;
  String? get slashQuery => widget.slashQuery;
  List<PiSlashCommand> get slashCommands => widget.slashCommands;
  bool get slashCommandsLoading => widget.slashCommandsLoading;
  Set<String> get dormantSkillNames => widget.dormantSkillNames;
  bool get slashViewCompact => widget.slashViewCompact;
  VoidCallback get onToggleSlashView => widget.onToggleSlashView;
  List<_PendingImage> get pendingImages => widget.pendingImages;
  ValueChanged<PiSlashCommand> get onSlashCommand => widget.onSlashCommand;
  VoidCallback get onPickImages => widget.onPickImages;
  VoidCallback? get onPickFiles => widget.onPickFiles;
  ValueChanged<int> get onRemoveImage => widget.onRemoveImage;
  VoidCallback get onSend => widget.onSend;
  VoidCallback? get onSendFollowUp => widget.onSendFollowUp;
  VoidCallback get onStop => widget.onStop;
  VoidCallback? get onPlanMode => widget.onPlanMode;
  VoidCallback? get onGoalMode => widget.onGoalMode;
  VoidCallback? get onUseCommand => widget.onUseCommand;
  VoidCallback? get onReferenceSession => widget.onReferenceSession;
  String? get atQuery => widget.atQuery;
  List<String> get atMatches => widget.atMatches;
  String? get hashQuery => widget.hashQuery;
  List<PiSnippet> get hashMatches => widget.hashMatches;
  ValueChanged<String>? get onApplyAt => widget.onApplyAt;
  ValueChanged<PiSnippet>? get onApplyHash => widget.onApplyHash;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (slashQuery != null)
            _SlashCommandPalette(
              query: slashQuery!,
              commands: slashCommands,
              loading: slashCommandsLoading,
              dormantSkillNames: dormantSkillNames,
              compact: slashViewCompact,
              onToggleView: onToggleSlashView,
              onSelected: onSlashCommand,
            ),
          if (pendingImages.isNotEmpty)
            SizedBox(
              height: 86,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 8),
                itemCount: pendingImages.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, index) => _ImagePreview(
                  image: pendingImages[index],
                  onRemove: () => onRemoveImage(index),
                ),
              ),
            ),
          if ((atQuery != null && atMatches.isNotEmpty) ||
              (hashQuery != null && hashMatches.isNotEmpty))
            _AutocompletePanel(
              atQuery: atQuery,
              atMatches: atMatches,
              hashQuery: hashQuery,
              hashMatches: hashMatches,
              onApplyAt: onApplyAt,
              onApplyHash: onApplyHash,
            ),
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 840),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(28, 5, 28, 10),
                child: Container(
                  key: const Key('chat-composer'),
                  constraints: const BoxConstraints(minHeight: 50),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surfaceContainerHigh,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: Theme.of(context).colorScheme.outlineVariant,
                    ),
                    boxShadow: AppleShadows.card,
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: Material(
                    color: Colors.transparent,
                    child: Row(
                      key: const Key('composer-single-line'),
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(left: 5),
                          child: _addButton(context),
                        ),
                        Expanded(
                          child: _textField(
                            context,
                            const EdgeInsets.fromLTRB(6, 14, 6, 14),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(6),
                          child: _sendButton(context),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _textField(BuildContext context, EdgeInsets contentPadding) =>
      TextField(
        // Stable key keeps the same EditableText element alive when the outer
        // layout switches between single-line (Row) and multiline (Column),
        // so focus and the soft keyboard are not dropped mid-typing.
        key: const Key('composer-text-field'),
        controller: controller,
        focusNode: _focusNode,
        enabled: !running,
        minLines: 1,
        maxLines: 6,
        textCapitalization: TextCapitalization.sentences,
        keyboardType: TextInputType.multiline,
        decoration: InputDecoration(
          hintText: context.tr('询问 Pi'),
          filled: false,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          disabledBorder: InputBorder.none,
          contentPadding: contentPadding,
        ),
      );

  Widget _addButton(BuildContext context) => Padding(
    padding: const EdgeInsets.only(left: 5, top: 5, bottom: 5),
    child: SizedBox.square(
      dimension: 40,
      child: PopupMenuButton<String>(
      key: const Key('add-menu'),
      onSelected: (value) {
        switch (value) {
          case 'plan':
            onPlanMode?.call();
            break;
          case 'goal':
            onGoalMode?.call();
            break;
          case 'upload':
            if (onPickFiles != null) {
              onPickFiles!();
            } else {
              onPickImages();
            }
            break;
          case 'command':
            onUseCommand?.call();
            break;
          case 'reference':
            onReferenceSession?.call();
            break;
        }
      },
      // Always tappable: even mid-run the user may pick a command, reference
      // a conversation, or queue an image for the next message.
      tooltip: context.tr('添加'),
      icon: const Icon(Icons.add_rounded, size: 26),
      itemBuilder: (context) => [
        PopupMenuItem(
          value: 'plan',
          child: Row(
            children: [
              const Icon(Icons.summarize_outlined, size: 20),
              const SizedBox(width: 10),
              Text(context.tr('计划')),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'goal',
          child: Row(
            children: [
              const Icon(Icons.flag_outlined, size: 20),
              const SizedBox(width: 10),
              Text(context.tr('目标')),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'upload',
          child: Row(
            children: [
              const Icon(Icons.upload_file_outlined, size: 20),
              const SizedBox(width: 10),
              Text(context.tr('上传文件')),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'command',
          child: Row(
            children: [
              const Icon(Icons.terminal_rounded, size: 20),
              const SizedBox(width: 10),
              Text(context.tr('使用命令')),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'reference',
          child: Row(
            children: [
              const Icon(Icons.chat_bubble_outline, size: 20),
              const SizedBox(width: 10),
              Text(context.tr('引用对话')),
            ],
          ),
        ),
      ],
    ),
    ),
  );

  Widget _sendButton(BuildContext context) {
    // 对齐网页端：运行中显示红色停止按钮（无论输入框是否有内容）；
    // 空闲时显示发送按钮。运行中输入内容时仍可长按排队（follow-up）。
    final hasContent =
        controller.text.trim().isNotEmpty || pendingImages.isNotEmpty;
    final canQueue = running && hasContent && onSendFollowUp != null;
    if (running) {
      return SizedBox.square(
        dimension: 38,
        child: IconButton(
          onPressed: onStop,
          onLongPress: canQueue
              ? () {
                  onSendFollowUp!();
                }
              : null,
          tooltip: context.tr('停止'),
          style: IconButton.styleFrom(
            backgroundColor: Theme.of(
              context,
            ).colorScheme.error.withValues(alpha: .12),
            foregroundColor: Theme.of(context).colorScheme.error,
          ),
          icon: const Icon(Icons.stop_rounded, size: 20),
        ),
      );
    }
    return SizedBox.square(
      dimension: 38,
      child: IconButton.filled(
        onPressed: onSend,
        tooltip: context.tr('发送'),
        icon: const Icon(Icons.arrow_upward_rounded, size: 18),
      ),
    );
  }
}

class _SlashCommandPalette extends StatelessWidget {
  const _SlashCommandPalette({
    required this.query,
    required this.commands,
    required this.loading,
    required this.dormantSkillNames,
    required this.compact,
    required this.onToggleView,
    required this.onSelected,
  });

  final String query;
  final List<PiSlashCommand> commands;
  final bool loading;
  final Set<String> dormantSkillNames;
  final bool compact;
  final VoidCallback onToggleView;
  final ValueChanged<PiSlashCommand> onSelected;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final ts = Theme.of(context).textTheme;

    // ── header ──
    final header = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              query.isEmpty
                  ? context.tr('{count} 个快捷命令', {'count': commands.length})
                  : context.tr('{count} 个匹配命令', {'count': commands.length}),
              style: ts.labelMedium,
            ),
          ),
          if (loading) ...[
            const SizedBox.square(
              dimension: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 7),
            Text(context.tr('正在加载资源…'), style: ts.labelSmall),
            const SizedBox(width: 4),
          ],
          // ── view toggle ──
          IconButton(
            visualDensity: VisualDensity.compact,
            icon: Icon(
              compact ? Icons.view_list_rounded : Icons.grid_view_rounded,
              size: 18,
            ),
            tooltip: compact ? context.tr('展开列表') : context.tr('紧凑视图'),
            onPressed: onToggleView,
          ),
        ],
      ),
    );

    // ── empty state ──
    final empty = !loading && commands.isEmpty;

    // ── body: compact chips ──
    Widget buildChips() {
      return SizedBox(
        height: 44,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          itemCount: commands.length,
          separatorBuilder: (_, _) => const SizedBox(width: 6),
          itemBuilder: (_, i) {
            final cmd = commands[i];
            final dormant =
                cmd.isSkill && dormantSkillNames.contains(cmd.skillName);
            return ChoiceChip(
              label: Text(
                '/${cmd.name}',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 13,
                  color: dormant ? cs.outline : null,
                ),
              ),
              avatar: Icon(
                cmd.isSkill
                    ? Icons.auto_awesome_outlined
                    : Icons.terminal_rounded,
                size: 14,
                color: dormant ? cs.outline : cs.primary,
              ),
              selected: false,
              onSelected: (_) => onSelected(cmd),
              visualDensity: VisualDensity.compact,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            );
          },
        ),
      );
    }

    // ── body: vertical grouped list ──
    Widget buildGroupedList() {
      final groups = <String, List<PiSlashCommand>>{};
      for (final cmd in commands) {
        groups.putIfAbsent(cmd.source, () => []).add(cmd);
      }
      final children = <Widget>[];
      for (final source in const ['builtin', 'extension', 'prompt', 'skill']) {
        final items = groups[source];
        if (items == null || items.isEmpty) continue;
        children.add(
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 5),
            child: Row(
              children: [
                Text(
                  items.first.sourceLabelFor(context.appLanguage),
                  style: ts.labelSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: cs.onSurfaceVariant,
                  ),
                ),
                const Spacer(),
                Text('${items.length}', style: ts.labelSmall),
              ],
            ),
          ),
        );
        children.addAll(
          items.map((cmd) {
            final dormant =
                cmd.isSkill && dormantSkillNames.contains(cmd.skillName);
            return InkWell(
              onTap: () => onSelected(cmd),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 9,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      cmd.isSkill
                          ? Icons.auto_awesome_outlined
                          : Icons.terminal_rounded,
                      size: 18,
                      color: dormant ? cs.outline : cs.primary,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  '/${cmd.name}',
                                  style: TextStyle(
                                    fontFamily: 'monospace',
                                    fontWeight: FontWeight.w600,
                                    color: dormant ? cs.outline : null,
                                  ),
                                ),
                              ),
                              if (dormant) ...[
                                const SizedBox(width: 7),
                                _CommandBadge(text: context.tr('已隐藏')),
                              ],
                            ],
                          ),
                          if (cmd.description.isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Text(
                              cmd.description,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: ts.bodySmall?.copyWith(
                                color: cs.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
        );
      }
      return Flexible(child: ListView(children: children));
    }

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .38,
      ),
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      decoration: const BoxDecoration(boxShadow: AppleShadows.floating),
      child: AppleGlass(
        borderRadius: BorderRadius.circular(AppleRadius.card),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            header,
            const Divider(height: 1),
            if (empty)
              Padding(
                padding: const EdgeInsets.all(18),
                child: Text(context.tr('没有找到匹配命令')),
              )
            else if (compact)
              buildChips()
            else
              buildGroupedList(),
          ],
        ),
      ),
    );
  }
}

class _CommandBadge extends StatelessWidget {
  const _CommandBadge({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
    decoration: BoxDecoration(
      border: Border.all(color: Theme.of(context).dividerColor),
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(text, style: Theme.of(context).textTheme.labelSmall),
  );
}

/// @ 文件引用 / # 快捷输入 自动补全面板。
class _AutocompletePanel extends StatelessWidget {
  const _AutocompletePanel({
    required this.atQuery,
    required this.atMatches,
    required this.hashQuery,
    required this.hashMatches,
    this.onApplyAt,
    this.onApplyHash,
  });

  final String? atQuery;
  final List<String> atMatches;
  final String? hashQuery;
  final List<PiSnippet> hashMatches;
  final ValueChanged<String>? onApplyAt;
  final ValueChanged<PiSnippet>? onApplyHash;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final showingAt = atQuery != null && atMatches.isNotEmpty;
    final items = <Widget>[];
    if (showingAt) {
      for (final path in atMatches) {
        final name = path.split(RegExp(r'[/\\]')).last;
        items.add(
          ListTile(
            dense: true,
            minTileHeight: 40,
            leading: const Icon(Icons.description_outlined, size: 18),
            title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: Text(
              path,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant),
            ),
            onTap: () => onApplyAt?.call(path),
          ),
        );
      }
    } else {
      for (final snippet in hashMatches) {
        items.add(
          ListTile(
            dense: true,
            minTileHeight: 40,
            leading: const Icon(Icons.bolt_rounded, size: 18),
            title: Text(
              snippet.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            onTap: () => onApplyHash?.call(snippet),
          ),
        );
      }
    }
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .3,
      ),
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      decoration: const BoxDecoration(boxShadow: AppleShadows.floating),
      child: AppleGlass(
        borderRadius: BorderRadius.circular(AppleRadius.card),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.symmetric(vertical: 4),
          children: items,
        ),
      ),
    );
  }
}

class _FunctionDrawer extends StatelessWidget {
  const _FunctionDrawer({
    required this.controller,
    required this.server,
    required this.themeMode,
    required this.compactOutput,
    required this.onThemeModeChanged,
    required this.onCompactOutputChanged,
    required this.languagePreference,
    required this.onLanguagePreferenceChanged,
    required this.onChooseDirectory,
    required this.onSkills,
    this.onGit,
    this.onProviders,
    this.onMcp,
    this.onSwitchServer,
    this.themeSetName = '',
    this.onThemeSetChanged,
    this.accent = AppleColors.accent,
    this.onAccentChanged,
  });

  final ChatController controller;
  final String server;
  final ThemeMode themeMode;
  final bool compactOutput;
  final ValueChanged<ThemeMode>? onThemeModeChanged;
  final ValueChanged<bool>? onCompactOutputChanged;
  final AppLanguagePreference languagePreference;
  final ValueChanged<AppLanguagePreference>? onLanguagePreferenceChanged;
  final VoidCallback onChooseDirectory;
  final VoidCallback onSkills;
  final VoidCallback? onGit;
  final VoidCallback? onProviders;
  final VoidCallback? onMcp;
  final VoidCallback? onSwitchServer;
  final String themeSetName;
  final ValueChanged<String>? onThemeSetChanged;
  final Color accent;
  final ValueChanged<Color>? onAccentChanged;

  String _languageLabel(BuildContext context) => switch (languagePreference) {
    AppLanguagePreference.system => context.tr('跟随系统'),
    AppLanguagePreference.zhHans => '简体中文',
    AppLanguagePreference.ja => '日本語',
    AppLanguagePreference.en => 'English',
  };

  Future<void> _showLanguagePicker(BuildContext context) async {
    final selected = await showModalBottomSheet<AppLanguagePreference>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(
                sheetContext.tr('选择应用语言'),
                style: Theme.of(sheetContext).textTheme.titleLarge,
              ),
              subtitle: Text(sheetContext.tr('系统语言不受支持时使用英语')),
            ),
            for (final preference in AppLanguagePreference.values)
              ListTile(
                leading: Icon(
                  preference == languagePreference
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  color: preference == languagePreference
                      ? Theme.of(sheetContext).colorScheme.primary
                      : null,
                ),
                title: Text(switch (preference) {
                  AppLanguagePreference.system => sheetContext.tr('跟随系统'),
                  AppLanguagePreference.zhHans => '简体中文',
                  AppLanguagePreference.ja => '日本語',
                  AppLanguagePreference.en => 'English',
                }),
                onTap: () => Navigator.pop(sheetContext, preference),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (selected != null && selected != languagePreference) {
      onLanguagePreferenceChanged?.call(selected);
    }
  }

  /// 思考级别选择器：off / low / medium / high / xhigh / max。
  Future<void> _showThinkingLevelPicker(BuildContext context) async {
    final current = controller.thinkingLevel;
    final selected = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Text(
                sheetContext.tr('思考级别'),
                style: Theme.of(
                  sheetContext,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            const Divider(height: 1),
            for (final level in ChatController.thinkingLevels)
              ListTile(
                leading: Icon(
                  current == level
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  color: current == level
                      ? Theme.of(sheetContext).colorScheme.primary
                      : null,
                ),
                title: Text(_thinkingLevelLabel(sheetContext, level)),
                onTap: () => Navigator.pop(sheetContext, level),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (selected != null && selected != current) {
      await controller.setThinkingLevel(selected);
    }
  }

  String _thinkingLevelLabel(BuildContext context, String level) =>
      switch (level) {
        'off' => context.tr('关闭'),
        'low' => context.tr('低'),
        'medium' => context.tr('中'),
        'high' => context.tr('高'),
        'xhigh' => context.tr('极高'),
        'max' => context.tr('最大'),
        _ => level,
      };

  /// 主题选择器：拉取网页端主题集列表，选择后切换。
  Future<void> _showThemePicker(BuildContext context) async {
    final themes = await controller.api.getThemes();
    if (!context.mounted) return;
    final selected = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Text(
                sheetContext.tr('选择主题'),
                style: Theme.of(
                  sheetContext,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  ListTile(
                    leading: const Icon(Icons.palette_outlined),
                    title: Text(sheetContext.tr('默认')),
                    trailing: themeSetName.isEmpty
                        ? Icon(
                            Icons.check_circle_rounded,
                            color: Theme.of(sheetContext).colorScheme.primary,
                          )
                        : null,
                    onTap: () => Navigator.pop(sheetContext, ''),
                  ),
                  for (final theme in themes)
                    ListTile(
                      leading: _themeSwatch(sheetContext, theme.accentLight),
                      title: Text(theme.displayName),
                      trailing: themeSetName == theme.name
                          ? Icon(
                              Icons.check_circle_rounded,
                              color: Theme.of(sheetContext).colorScheme.primary,
                            )
                          : null,
                      onTap: () => Navigator.pop(sheetContext, theme.name),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
    if (selected != null && selected != themeSetName) {
      onThemeSetChanged?.call(selected);
    }
  }

  /// 主题色块（使用主题的亮色 accent）。
  Widget _themeSwatch(BuildContext context, String? hex) {
    final color = colorFromHex(hex);
    return Container(
      width: 22,
      height: 22,
      decoration: BoxDecoration(
        color: color ?? Theme.of(context).colorScheme.outlineVariant,
        shape: BoxShape.circle,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Drawer(
      backgroundColor: Colors.transparent,
      child: AppleGlass(
        borderRadius: const BorderRadius.horizontal(
          left: Radius.circular(AppleRadius.panel),
        ),
        child: Material(
          color: Colors.transparent,
          child: Theme(
            // 设置菜单使用更紧凑的字号（对齐网页端设置面板）
            data: Theme.of(context).copyWith(
              listTileTheme: ListTileThemeData(
                titleTextStyle: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w500,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
                subtitleTextStyle: TextStyle(
                  fontSize: 11.5,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                iconColor: Theme.of(context).colorScheme.onSurfaceVariant,
                dense: true,
                visualDensity: VisualDensity.compact,
              ),
            ),
            child: SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 18, 8, 14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              context.tr('功能与显示'),
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            Text(
                              context.tr('也可以从屏幕右边缘向左滑打开'),
                              style: Theme.of(context).textTheme.labelSmall
                                  ?.copyWith(
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.onSurfaceVariant,
                                  ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        tooltip: context.tr('关闭'),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Material(
                            color: Theme.of(context).colorScheme.surface,
                            borderRadius: BorderRadius.circular(
                              AppleRadius.panel,
                            ),
                            clipBehavior: Clip.antiAlias,
                            child: Column(
                              children: [
                                ListTile(
                                  leading: const Icon(
                                    Icons.folder_open_outlined,
                                  ),
                                  title: Text(context.tr('选择工作目录')),
                                  subtitle: Text(
                                    controller.draftCwd ??
                                        context.tr('选择目录并开始新对话'),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: onChooseDirectory,
                                ),
                                const Divider(indent: 56),
                                ListTile(
                                  leading: const Icon(
                                    Icons.auto_awesome_outlined,
                                  ),
                                  title: Text(context.tr('技能')),
                                  subtitle: Text(
                                    controller.loadingSkills
                                        ? context.tr('正在读取已加载技能…')
                                        : context.tr('{count} 个已加载技能', {
                                            'count': controller.skills.length,
                                          }),
                                  ),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: onSkills,
                                ),
                                const Divider(indent: 56),
                                ListTile(
                                  leading: const Icon(Icons.commit_rounded),
                                  title: Text(context.tr('Git 变更')),
                                  subtitle: Text(
                                    controller.draftCwd == null
                                        ? context.tr('选择目录并开始新对话')
                                        : context.tr('查看当前项目的变更'),
                                  ),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: onGit,
                                  enabled: onGit != null,
                                ),
                                const Divider(indent: 56),
                                ListTile(
                                  leading: const Icon(Icons.hub_outlined),
                                  title: Text(context.tr('模型供应商')),
                                  subtitle: Text(context.tr('配置 API Key 供应商')),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: onProviders,
                                  enabled: onProviders != null,
                                ),
                                const Divider(indent: 56),
                                ListTile(
                                  leading: const Icon(Icons.terminal_outlined),
                                  title: Text(context.tr('MCP 服务器')),
                                  subtitle: Text(context.tr('管理 MCP 服务器配置')),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: onMcp,
                                  enabled: onMcp != null,
                                ),
                              ],
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 10, 20, 14),
                          child: InkWell(
                            onTap: onSwitchServer,
                            borderRadius: BorderRadius.circular(10),
                            child: Row(
                              children: [
                                Icon(
                                  Icons.dns_outlined,
                                  size: 16,
                                  color: Theme.of(context).colorScheme.outline,
                                ),
                                const SizedBox(width: 7),
                                Expanded(
                                  child: Text(
                                    server,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: Theme.of(context)
                                        .textTheme
                                        .labelSmall
                                        ?.copyWith(
                                          color: Theme.of(
                                            context,
                                          ).colorScheme.outline,
                                        ),
                                  ),
                                ),
                                if (onSwitchServer != null) ...[
                                  const SizedBox(width: 6),
                                  Icon(
                                    Icons.swap_horiz_rounded,
                                    size: 16,
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.outline,
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Material(
                            color: Theme.of(context).colorScheme.surface,
                            borderRadius: BorderRadius.circular(
                              AppleRadius.panel,
                            ),
                            clipBehavior: Clip.antiAlias,
                            child: Column(
                              children: [
                                SwitchListTile(
                                  value: dark,
                                  onChanged: onThemeModeChanged == null
                                      ? null
                                      : (enabled) => onThemeModeChanged!(
                                          enabled
                                              ? ThemeMode.dark
                                              : ThemeMode.light,
                                        ),
                                  secondary: Icon(
                                    dark
                                        ? Icons.dark_mode_outlined
                                        : Icons.light_mode_outlined,
                                  ),
                                  title: Text(
                                    context.tr(dark ? '深色模式' : '浅色模式'),
                                  ),
                                  subtitle: Text(context.tr('立即切换 App 的显示外观')),
                                ),
                                if (onAccentChanged != null) ...[
                                  const Divider(indent: 56),
                                  ListTile(
                                    leading: const Icon(Icons.color_lens_outlined),
                                    title: Text(context.tr('主题色')),
                                    subtitle: Text(context.tr('选择本地色板或网页端主题色')),
                                    trailing: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Container(
                                          width: 18,
                                          height: 18,
                                          decoration: BoxDecoration(
                                            color: Theme.of(
                                              context,
                                            ).colorScheme.primary,
                                            shape: BoxShape.circle,
                                          ),
                                        ),
                                        const Icon(Icons.chevron_right),
                                      ],
                                    ),
                                    onTap: () => showAccentMenu(
                                      context,
                                      controller: controller,
                                      selected: accent,
                                      onChanged: onAccentChanged!,
                                      onThemeSet: onThemeSetChanged,
                                    ),
                                  ),
                                ],
                                const Divider(indent: 56),
                                ValueListenableBuilder<double>(
                                  valueListenable: fontScaleNotifier,
                                  builder: (context, fontScale, _) =>
                                      ListTile(
                                    leading: const Icon(
                                      Icons.format_size_rounded,
                                    ),
                                    title: Text(context.tr('字体大小')),
                                    subtitle: Slider(
                                      value: fontScale,
                                      min: 0.8,
                                      max: 1.3,
                                      divisions: 5,
                                      label:
                                          '${(fontScale * 100).round()}%',
                                      onChanged: (value) =>
                                          setFontScale(value),
                                    ),
                                  ),
                                ),
                                const Divider(indent: 56),
                                ListTile(
                                  leading: const Icon(
                                    Icons.psychology_outlined,
                                  ),
                                  title: Text(context.tr('思考级别')),
                                  subtitle: Text(
                                    _thinkingLevelLabel(
                                      context,
                                      controller.thinkingLevel,
                                    ),
                                  ),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: () =>
                                      _showThinkingLevelPicker(context),
                                ),
                                const Divider(indent: 56),
                                ListTile(
                                  leading: const Icon(Icons.language_rounded),
                                  title: Text(context.tr('语言')),
                                  subtitle: Text(_languageLabel(context)),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: onLanguagePreferenceChanged == null
                                      ? null
                                      : () => _showLanguagePicker(context),
                                ),
                                const Divider(indent: 56),
                                ListTile(
                                  leading: const Icon(Icons.palette_outlined),
                                  title: Text(context.tr('主题')),
                                  subtitle: Text(
                                    themeSetName.isEmpty
                                        ? context.tr('默认')
                                        : themeSetName,
                                  ),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: onThemeSetChanged == null
                                      ? null
                                      : () => _showThemePicker(context),
                                ),
                              ],
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
                          child: Text(
                            compactOutput
                                ? context.tr(
                                    '中间消息不会绘制在聊天页，但当前服务仍会发送数据；服务端支持按需详情后才能进一步节省流量。',
                                  )
                                : context.tr('当前会实时显示思考、工具调用和中间消息。'),
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
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(20),
                  child: Text(
                    context.tr(
                      themeMode == ThemeMode.system
                          ? context.tr('当前跟随系统外观')
                          : context.tr('外观设置已保存在本机'),
                    ),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: Theme.of(context).colorScheme.outline,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
    );
  }
}

class _SessionDrawer extends StatefulWidget {
  const _SessionDrawer({
    required this.controller,
    required this.onNewChat,
    required this.onOpen,
    required this.onDelete,
    required this.onLogout,
    this.onSwitchServer,
    this.onSwitchProject,
    this.embedded = false,
  });
  final ChatController controller;
  final VoidCallback onNewChat;
  final ValueChanged<PiSession> onOpen;
  final ValueChanged<PiSession> onDelete;
  final VoidCallback onLogout;
  final VoidCallback? onSwitchServer;

  /// Switches to a recent project directory (starts a fresh chat there).
  final ValueChanged<String>? onSwitchProject;

  /// When true, renders as a permanent sidebar pane (no Drawer shell, no close
  /// button) for wide-screen two-pane layout. Drawer behavior stays untouched
  /// on phones.
  final bool embedded;

  @override
  State<_SessionDrawer> createState() => _SessionDrawerState();
}

class _SessionDrawerState extends State<_SessionDrawer> {
  final _scrollController = ScrollController();
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  String get _query => _searchController.text.trim().toLowerCase();

  /// Most recently modified project directories (deduplicated, up to 5).
  List<String> get _recentProjects {
    final seen = <String>{};
    final projects = <String>[];
    final sessions = [...widget.controller.sessions]
      ..sort((a, b) => b.modified.compareTo(a.modified));
    for (final session in sessions) {
      if (session.cwd.isEmpty || seen.contains(session.cwd)) continue;
      seen.add(session.cwd);
      projects.add(session.cwd);
      if (projects.length >= 5) break;
    }
    return projects;
  }

  /// 编辑项目备注（显示别名）。空字符串清除备注。
  Future<void> _editProjectAlias(
    BuildContext context,
    String cwd,
    String current,
  ) async {
    final controller = TextEditingController(text: current);
    final alias = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(dialogContext.tr('项目备注')),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 40,
          decoration: InputDecoration(
            hintText: dialogContext.tr('输入备注名称（留空清除）'),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(dialogContext.tr('取消')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text),
            child: Text(dialogContext.tr('保存')),
          ),
        ],
      ),
    );
    controller.dispose();
    if (alias == null || !mounted) return;
    final ok = await widget.controller.setProjectAlias(cwd, alias);
    if (ok || !mounted) return;
    if (!context.mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(context.tr('备注保存失败，请稍后重试'))));
  }

  @override
  Widget build(BuildContext context) {
    final grouped = <String, List<PiSession>>{};
    final query = _query;
    for (final session in widget.controller.sessions) {
      final alias = widget.controller.projectAliases[session.cwd]?.trim();
      final matchesQuery =
          query.isEmpty ||
          session.cwd.toLowerCase().contains(query) ||
          session.titleFor(context.appLanguage).toLowerCase().contains(query) ||
          session.id.toLowerCase().contains(query) ||
          (alias != null &&
              alias.isNotEmpty &&
              alias.toLowerCase().contains(query));
      if (matchesQuery) {
        grouped.putIfAbsent(session.cwd, () => []).add(session);
      }
    }
    // Running sessions float to the top of their directory; directories with
    // any running session are pinned above the rest (same as requested for
    // the web client's "running projects on top").
    for (final sessions in grouped.values) {
      sessions.sort((a, b) {
        if (a.running != b.running) return a.running ? -1 : 1;
        return b.modified.compareTo(a.modified);
      });
    }
    final controller = widget.controller;
    final directories = grouped.keys.toList()
      ..sort((a, b) {
        final aRunning = controller.directoryHasRunning(a);
        final bRunning = controller.directoryHasRunning(b);
        if (aRunning != bRunning) return aRunning ? -1 : 1;
        return a.toLowerCase().compareTo(b.toLowerCase());
      });
    final pane = AppleGlass(
      borderRadius: widget.embedded
          ? BorderRadius.circular(0)
          : const BorderRadius.horizontal(
              right: Radius.circular(AppleRadius.panel),
            ),
      child: Material(
        color: Colors.transparent,
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 8, 14),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        context.tr('对话'),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    if (!widget.embedded)
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        tooltip: context.tr('关闭'),
                        icon: const Icon(Icons.close),
                      ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 2, 16, 10),
                child: TextField(
                  controller: _searchController,
                  onChanged: (_) => setState(() {}),
                  autocorrect: false,
                  decoration: InputDecoration(
                    hintText: context.tr('搜索会话'),
                    prefixIcon: const Icon(Icons.search, size: 20),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    suffixIcon: _searchController.text.isEmpty
                        ? null
                        : IconButton(
                            tooltip: context.tr('清除'),
                            icon: const Icon(Icons.clear, size: 18),
                            onPressed: () {
                              _searchController.clear();
                              setState(() {});
                            },
                          ),
                  ),
                ),
              ),
              if (_recentProjects.isNotEmpty) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                  child: SizedBox(
                    height: 34,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: _recentProjects.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 6),
                      itemBuilder: (context, index) {
                        final cwd = _recentProjects[index];
                        final alias = widget.controller.projectAliases[cwd]
                            ?.trim();
                        final name = (alias != null && alias.isNotEmpty)
                            ? alias
                            : (cwd
                                      .split(RegExp(r'[/\\]'))
                                      .where((part) => part.isNotEmpty)
                                      .lastOrNull ??
                                  cwd);
                        return ActionChip(
                          visualDensity: VisualDensity.compact,
                          avatar: const Icon(Icons.history, size: 15),
                          label: Text(name),
                          onPressed: widget.onSwitchProject == null
                              ? null
                              : () {
                                  _searchController.clear();
                                  widget.onSwitchProject!(cwd);
                                },
                        );
                      },
                    ),
                  ),
                ),
              ],
              const Divider(height: 1),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: widget.controller.refreshSessions,
                  child:
                      widget.controller.loadingSessions &&
                          widget.controller.sessions.isEmpty
                      ? const Center(child: CircularProgressIndicator())
                      : directories.isEmpty
                      ? _EmptySearchResult(
                          searching: query.isNotEmpty,
                          onClear: () {
                            _searchController.clear();
                            setState(() {});
                          },
                        )
                      : Scrollbar(
                          controller: _scrollController,
                          thumbVisibility: true,
                          interactive: true,
                          child: ListView.builder(
                            controller: _scrollController,
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: const EdgeInsets.fromLTRB(4, 8, 12, 8),
                            itemCount: directories.length,
                            itemBuilder: (context, index) {
                              final cwd = directories[index];
                              final sessions = grouped[cwd]!;
                              final folderName = cwd
                                  .split(RegExp(r'[/\\]'))
                                  .where((part) => part.isNotEmpty)
                                  .lastOrNull;
                              final hasRunning = widget.controller
                                  .directoryHasRunning(cwd);
                              final alias = widget
                                  .controller
                                  .projectAliases[cwd]
                                  ?.trim();
                              return ExpansionTile(
                                key: PageStorageKey(cwd),
                                initiallyExpanded: sessions.any(
                                  (session) =>
                                      session.id ==
                                      widget.controller.activeSessionId,
                                ),
                                leading: hasRunning
                                    ? const SizedBox.square(
                                        dimension: 20,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                        ),
                                      )
                                    : const Icon(Icons.folder_outlined),
                                title: Row(
                                  children: [
                                    Flexible(
                                      child: Text(
                                        (alias != null && alias.isNotEmpty)
                                            ? alias
                                            : (folderName ?? cwd),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 4),
                                    InkWell(
                                      onTap: () => _editProjectAlias(
                                        context,
                                        cwd,
                                        alias ?? '',
                                      ),
                                      borderRadius: BorderRadius.circular(6),
                                      child: Padding(
                                        padding: const EdgeInsets.all(3),
                                        child: Icon(
                                          Icons.edit_note_rounded,
                                          size: 17,
                                          color: Theme.of(
                                            context,
                                          ).colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                subtitle: Text(
                                  context.tr('{path} · {count} 个对话', {
                                    'path': cwd,
                                    'count': sessions.length,
                                  }),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                children: sessions.map((session) {
                                  final selected =
                                      session.id ==
                                      widget.controller.activeSessionId;
                                  return ListTile(
                                    selected: selected,
                                    contentPadding: const EdgeInsets.only(
                                      left: 34,
                                      right: 10,
                                    ),
                                    leading: session.running
                                        ? const SizedBox.square(
                                            dimension: 18,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                            ),
                                          )
                                        : const Icon(
                                            Icons.chat_bubble_outline,
                                            size: 19,
                                          ),
                                    title: Text(
                                      session.titleFor(context.appLanguage),
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    subtitle: Text(
                                      DateFormat(
                                        'MM-dd HH:mm',
                                      ).format(session.modified.toLocal()),
                                    ),
                                    trailing:
                                        widget.controller.deletingSessionIds
                                            .contains(session.id)
                                        ? const SizedBox.square(
                                            dimension: 20,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                            ),
                                          )
                                        : IconButton(
                                            key: Key(
                                              'delete-session-${session.id}',
                                            ),
                                            onPressed: () =>
                                                widget.onDelete(session),
                                            tooltip: context.tr('删除对话'),
                                            icon: const Icon(
                                              Icons.delete_outline,
                                              size: 20,
                                            ),
                                          ),
                                    onTap: () => widget.onOpen(session),
                                  );
                                }).toList(),
                              );
                            },
                          ),
                        ),
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
                child: SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: FilledButton.icon(
                    key: const Key('drawer-new-chat-button'),
                    onPressed: () {
                      Navigator.pop(context);
                      widget.onNewChat();
                    },
                    icon: const Icon(Icons.edit_square),
                    label: Text(context.tr('新建对话')),
                    style: FilledButton.styleFrom(
                      shape: const StadiumBorder(),
                      textStyle: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.swap_horiz_rounded),
                title: Text(context.tr('切换服务器')),
                onTap: widget.onSwitchServer,
                enabled: widget.onSwitchServer != null,
              ),
              ListTile(
                leading: const Icon(Icons.logout),
                title: Text(context.tr('退出登录')),
                onTap: () {
                  if (!widget.embedded) Navigator.pop(context);
                  widget.onLogout();
                },
              ),
            ],
          ),
        ),
      ),
    );
    return widget.embedded
        ? pane
        : Drawer(backgroundColor: Colors.transparent, child: pane);
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
  T? get lastOrNull => isEmpty ? null : last;
}

class ServerSwitcherSheet extends StatefulWidget {
  const ServerSwitcherSheet({
    super.key,
    required this.currentId,
    required this.onSwitch,
  });

  final String currentId;
  final ValueChanged<String> onSwitch;

  @override
  State<ServerSwitcherSheet> createState() => _ServerSwitcherSheetState();
}

class _ServerSwitcherSheetState extends State<ServerSwitcherSheet> {
  final _store = ProfileStore();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: FutureBuilder<List<ServerProfile>>(
        future: _store.readAll(),
        builder: (context, snapshot) {
          final profiles = snapshot.data ?? const <ServerProfile>[];
          return Container(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(context).height * .7,
            ),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(AppleRadius.panel),
              ),
              boxShadow: AppleShadows.floating,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 10),
                Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 14, 8, 6),
                  child: Row(
                    children: [
                      Icon(
                        Icons.dns_outlined,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          context.tr('切换服务器'),
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        tooltip: context.tr('关闭'),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                ),
                if (snapshot.connectionState == ConnectionState.waiting)
                  const Padding(
                    padding: EdgeInsets.all(32),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (profiles.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(32),
                    child: Center(
                      child: Text(
                        context.tr('还没有已保存的服务器'),
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  )
                else
                  Flexible(
                    child: ListView(
                      shrinkWrap: true,
                      children: [
                        for (
                          var index = 0;
                          index < profiles.length;
                          index++
                        ) ...[
                          if (index > 0) const Divider(indent: 54),
                          ListTile(
                            leading: Icon(
                              profiles[index].id == widget.currentId
                                  ? Icons.radio_button_checked
                                  : Icons.radio_button_unchecked,
                              color: profiles[index].id == widget.currentId
                                  ? Theme.of(context).colorScheme.primary
                                  : null,
                            ),
                            title: Text(
                              profiles[index].baseUrl,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            subtitle: Text(
                              profiles[index].id == widget.currentId
                                  ? context.tr('当前服务器')
                                  : profiles[index].username,
                            ),
                            onTap: profiles[index].id == widget.currentId
                                ? null
                                : () => widget.onSwitch(profiles[index].id),
                          ),
                        ],
                        const SizedBox(height: 12),
                      ],
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// 引用对话选择器：列出可选的会话，点选后返回选中的会话。
class _SessionReferenceSheet extends StatefulWidget {
  const _SessionReferenceSheet({
    required this.sessions,
    required this.language,
  });

  final List<PiSession> sessions;
  final AppLanguage language;

  @override
  State<_SessionReferenceSheet> createState() => _SessionReferenceSheetState();
}

class _SessionReferenceSheetState extends State<_SessionReferenceSheet> {
  String _query = '';

  List<PiSession> get _filtered {
    final q = _query.trim().toLowerCase();
    final all = [...widget.sessions]
      ..sort((a, b) => b.modified.compareTo(a.modified));
    if (q.isEmpty) return all;
    return all
        .where(
          (s) =>
              s.titleFor(widget.language).toLowerCase().contains(q) ||
              s.cwd.toLowerCase().contains(q),
        )
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final items = _filtered;
    return SafeArea(
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * .75,
        ),
        padding: const EdgeInsets.only(bottom: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
              child: Text(
                context.tr('引用对话'),
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: TextField(
                onChanged: (value) => setState(() => _query = value),
                decoration: InputDecoration(
                  hintText: context.tr('搜索会话'),
                  prefixIcon: const Icon(Icons.search, size: 20),
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                ),
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: items.isEmpty
                  ? Center(
                      child: Text(
                        context.tr('没有找到匹配会话'),
                        style: TextStyle(color: cs.onSurfaceVariant),
                      ),
                    )
                  : ListView.separated(
                      itemCount: items.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final session = items[index];
                        return ListTile(
                          leading: session.running
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.chat_bubble_outline, size: 20),
                          title: Text(
                            session.titleFor(widget.language),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            session.cwd,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          onTap: () => Navigator.pop(context, session),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 主题色独立菜单：网页端主题集色板（点击即切换主题）+ 本地色板。
/// 对齐网页端 DisplayConfig：主题集 accent 与自定义 accent 二选一。
Future<void> showAccentMenu(
  BuildContext context, {
  required ChatController controller,
  required Color selected,
  required ValueChanged<Color> onChanged,
  ValueChanged<String>? onThemeSet,
}) async {
  List<ThemeSet> themes = const [];
  try {
    themes = await controller.api.getThemes();
  } catch (_) {
    themes = const [];
  }
  if (!context.mounted) return;
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (sheetContext) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: Text(
              sheetContext.tr('主题色'),
              style: Theme.of(
                sheetContext,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
          const Divider(height: 1),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // ── 本地色板 ──
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 6, 20, 4),
                    child: Text(
                      sheetContext.tr('本地色板'),
                      style: Theme.of(sheetContext).textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: AccentPicker(
                      selected: selected,
                      onChanged: (color) {
                        Navigator.pop(sheetContext);
                        onChanged(color);
                      },
                      labels: {
                        for (final (name, key) in appleAccentChoices)
                          name: sheetContext.tr(key),
                      },
                    ),
                  ),
                  const Divider(indent: 20, endIndent: 20),
                  // ── 网页端主题集色板 ──
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 6, 20, 4),
                    child: Text(
                      sheetContext.tr('网页端主题色'),
                      style: Theme.of(sheetContext).textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  if (themes.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        sheetContext.tr('暂无可用主题'),
                        style: TextStyle(
                          color: Theme.of(
                            sheetContext,
                          ).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    )
                  else
                    for (final theme in themes)
                      ListTile(
                        dense: true,
                        leading: _accentSwatch(sheetContext, theme.accentLight),
                        title: Text(theme.displayName),
                        subtitle: theme.accent != null
                            ? Text(
                                theme.accent!,
                                style: TextStyle(
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  color: Theme.of(
                                    sheetContext,
                                  ).colorScheme.onSurfaceVariant,
                                ),
                              )
                            : null,
                        trailing: const Icon(Icons.chevron_right, size: 18),
                        onTap: () {
                          Navigator.pop(sheetContext);
                          onThemeSet?.call(theme.name);
                        },
                      ),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

/// 圆形象征色块。
Widget _accentSwatch(BuildContext context, String? hex) {
  final color = colorFromHex(hex);
  return Container(
    width: 20,
    height: 20,
    decoration: BoxDecoration(
      color: color ?? Theme.of(context).colorScheme.outlineVariant,
      shape: BoxShape.circle,
    ),
  );
}
