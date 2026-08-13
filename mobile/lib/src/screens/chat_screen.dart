import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../apple_theme.dart';
import '../chat_controller.dart';
import '../localization.dart';
import '../models.dart';
import '../profile_store.dart';
import 'directory_picker.dart';
import 'git_sheet.dart';
import 'model_picker.dart';
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
  String? _visibleSessionId;
  final List<_PendingImage> _pendingImages = [];

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
  }

  @override
  void dispose() {
    chat.removeListener(_onChanged);
    _messageController.removeListener(_onComposerChanged);
    _scrollController.removeListener(_trackScrollPosition);
    _messageController.dispose();
    _scrollController.dispose();
    _pendingImages.clear();
    super.dispose();
  }

  void _onChanged() {
    if (!mounted) return;
    if (_visibleSessionId != chat.activeSessionId || chat.messages.isEmpty) {
      _visibleSessionId = chat.activeSessionId;
      _stickToBottom = true;
      _showJumpToBottom = false;
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

  void _onComposerChanged() {
    if (!mounted) return;
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

  Future<void> _send() async {
    final value = _messageController.text;
    if ((value.trim().isEmpty && _pendingImages.isEmpty) || chat.running) {
      return;
    }
    final builtin = _pendingImages.isEmpty
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
    final images = _pendingImages.map((image) => image.attachment).toList();
    setState(_pendingImages.clear);
    await chat.send(value, images: images);
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
        onChooseDirectory: _chooseNewChat,
        onSkills: () {
          Navigator.pop(context);
          showSkillsSheet(context, controller: chat);
        },
        onGit: () {
          Navigator.pop(context);
          showGitSheet(context, controller: chat);
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
                onRemoveImage: (index) =>
                    setState(() => _pendingImages.removeAt(index)),
                onSend: _send,
                onStop: chat.stop,
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
        result.add(
          _MessageBubble(message: message, onLoadThinking: _loadThinking),
        );
        index += 1;
        continue;
      }

      result.add(
        _MessageBubble(message: message, onLoadThinking: _loadThinking),
      );
      var end = index + 1;
      while (end < messages.length && messages[end].role != 'user') {
        end += 1;
      }
      final liveTail = chat.running && end == messages.length;
      if (liveTail) {
        if (widget.compactOutput) {
          compactLiveTail = true;
          for (var current = index + 1; current < end; current++) {
            if (_hasDisplayableContent(messages[current])) {
              compactProcessMessages += 1;
              compactToolCalls += messages[current].toolCallCount;
            }
          }
        } else {
          for (var current = index + 1; current < end; current++) {
            result.add(
              _MessageBubble(
                message: messages[current],
                onLoadThinking: _loadThinking,
              ),
            );
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
        for (var current = index + 1; current < end; current++) {
          result.add(
            _MessageBubble(
              message: messages[current],
              onLoadThinking: _loadThinking,
            ),
          );
        }
        index = end;
        continue;
      }

      final processWidgets = <Widget>[];
      var processMessageCount = 0;
      var toolCallCount = 0;
      for (var current = index + 1; current < finalAnswer; current++) {
        final process = messages[current];
        if (_hasDisplayableContent(process)) {
          processWidgets.add(
            _MessageBubble(
              message: process,
              inProcessGroup: true,
              onLoadThinking: _loadThinking,
            ),
          );
          processMessageCount += 1;
          toolCallCount += process.toolCallCount;
        }
      }
      final answer = messages[finalAnswer];
      if (answer.thinking.isNotEmpty || answer.processText.isNotEmpty) {
        processWidgets.add(
          _MessageBubble(
            message: answer.copyWith(text: ''),
            inProcessGroup: true,
            onLoadThinking: _loadThinking,
          ),
        );
        processMessageCount += 1;
        toolCallCount += answer.toolCallCount;
      }
      if (processWidgets.isNotEmpty) {
        result.add(
          _ProcessDetailsGroup(
            messageCount: processMessageCount,
            toolCallCount: toolCallCount,
            children: processWidgets,
          ),
        );
      }
      result.add(
        _MessageBubble(
          message: answer.copyWith(thinking: '', processText: ''),
          onLoadThinking: _loadThinking,
        ),
      );
      for (var current = finalAnswer + 1; current < end; current++) {
        result.add(
          _MessageBubble(
            message: messages[current],
            onLoadThinking: _loadThinking,
          ),
        );
      }
      index = end;
    }
    final streaming = chat.streamingMessage;
    if (widget.compactOutput && (compactLiveTail || streaming != null)) {
      if (streaming != null && _hasDisplayableContent(streaming)) {
        compactProcessMessages += 1;
        compactToolCalls += streaming.toolCallCount;
      }
      result.add(
        _CompactRunningStatus(
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
    this.inProcessGroup = false,
    this.onLoadThinking,
  });
  final ChatMessage message;
  final bool streaming;
  final bool inProcessGroup;

  /// Fetches deferred thinking for [message]. When null, thinking is only
  /// shown if already loaded.
  final Future<void> Function(ChatMessage message)? onLoadThinking;

  /// Caps bubble width so iPad landscape and wide windows keep readable lines.
  /// Width scales with the screen up to a fixed ceiling.
  double _bubbleMaxWidth(BuildContext context, bool user) {
    final screenWidth = MediaQuery.sizeOf(context).width;
    final ratio = user ? .82 : .94;
    final ceiling = user ? 760.0 : 840.0;
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
    if (message.text.trim().isEmpty &&
        message.thinking.isEmpty &&
        message.processText.isEmpty &&
        !streaming) {
      return const SizedBox.shrink();
    }
    return Align(
      alignment: user ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: _bubbleMaxWidth(context, user)),
        margin: EdgeInsets.symmetric(vertical: inProcessGroup ? 3 : 6),
        padding: EdgeInsets.symmetric(horizontal: user ? 16 : 8, vertical: 12),
        decoration: BoxDecoration(
          color: user
              ? (Theme.of(context).brightness == Brightness.dark
                    ? Theme.of(context).colorScheme.surfaceContainerHighest
                    : const Color(0xffe8e8ed))
              : tool
              ? Theme.of(context).colorScheme.surface
              : Colors.transparent,
          borderRadius: BorderRadius.circular(18),
          border: tool
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
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (message.thinking.isNotEmpty)
                    _ThinkingSection(
                      thinking: message.thinking,
                      streaming: streaming,
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
                          message.text.isNotEmpty))
                    const SizedBox(height: 8),
                  if (message.processText.isNotEmpty)
                    MarkdownBody(
                      data: message.processText,
                      selectable: true,
                      styleSheet:
                          MarkdownStyleSheet.fromTheme(
                            Theme.of(context),
                          ).copyWith(
                            p: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: Theme.of(
                                context,
                              ).colorScheme.onSurfaceVariant,
                            ),
                          ),
                    ),
                  if (message.processText.isNotEmpty && message.text.isNotEmpty)
                    const SizedBox(height: 8),
                  if (message.text.isNotEmpty)
                    MarkdownBody(
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
    );
  }
}

class _ProcessDetailsGroup extends StatefulWidget {
  const _ProcessDetailsGroup({
    required this.messageCount,
    required this.toolCallCount,
    required this.children,
  });
  final int messageCount;
  final int toolCallCount;
  final List<Widget> children;

  @override
  State<_ProcessDetailsGroup> createState() => _ProcessDetailsGroupState();
}

class _CompactRunningStatus extends StatelessWidget {
  const _CompactRunningStatus({
    required this.messageCount,
    required this.toolCallCount,
  });

  final int messageCount;
  final int toolCallCount;

  @override
  Widget build(BuildContext context) {
    final details = <String>[
      context.tr('Pi 正在处理'),
      if (messageCount > 0) context.tr('{count} 个步骤', {'count': messageCount}),
      if (toolCallCount > 0)
        context.tr('{count} 个工具调用', {'count': toolCallCount}),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          const SizedBox.square(
            dimension: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              details,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProcessDetailsGroupState extends State<_ProcessDetailsGroup> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final motionDuration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 240);
    final details = <String>[
      context.tr('处理详情'),
      context.tr('{count} 条消息', {'count': widget.messageCount}),
      if (widget.toolCallCount > 0)
        context.tr('{count} 个工具调用', {'count': widget.toolCallCount}),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => setState(() => _expanded = !_expanded),
              style: TextButton.styleFrom(
                foregroundColor: Theme.of(context).colorScheme.onSurfaceVariant,
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
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
          AnimatedSize(
            duration: motionDuration,
            curve: Curves.easeOutQuart,
            child: _expanded
                ? Container(
                    margin: const EdgeInsets.only(top: 6, left: 7),
                    padding: const EdgeInsets.only(left: 8),
                    decoration: BoxDecoration(
                      border: Border(
                        left: BorderSide(color: Theme.of(context).dividerColor),
                      ),
                    ),
                    child: Column(children: widget.children),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

class _ThinkingSection extends StatelessWidget {
  const _ThinkingSection({required this.thinking, required this.streaming});
  final String thinking;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        initiallyExpanded: false,
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
    required this.onRemoveImage,
    required this.onSend,
    required this.onStop,
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
  final ValueChanged<int> onRemoveImage;
  final VoidCallback onSend;
  final VoidCallback onStop;

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
  ValueChanged<int> get onRemoveImage => widget.onRemoveImage;
  VoidCallback get onSend => widget.onSend;
  VoidCallback get onStop => widget.onStop;

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
                      crossAxisAlignment: CrossAxisAlignment.end,
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

  Widget _addButton(BuildContext context) => SizedBox.square(
    dimension: 40,
    child: IconButton(
      key: const Key('add-local-images'),
      onPressed: running ? null : onPickImages,
      tooltip: context.tr('添加本地图片'),
      icon: const Icon(Icons.add_rounded, size: 26),
    ),
  );

  Widget _sendButton(BuildContext context) => SizedBox.square(
    dimension: 38,
    child: IconButton.filled(
      onPressed: running ? onStop : onSend,
      tooltip: context.tr(running ? '停止' : '发送'),
      icon: AnimatedSwitcher(
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 160),
        child: Icon(
          running ? Icons.stop_rounded : Icons.arrow_upward_rounded,
          key: ValueKey(running),
        ),
      ),
    ),
  );
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
    this.onSwitchServer,
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
  final VoidCallback? onSwitchServer;

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
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Material(
                    color: Theme.of(context).colorScheme.surface,
                    borderRadius: BorderRadius.circular(AppleRadius.panel),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      children: [
                        ListTile(
                          leading: const Icon(Icons.folder_open_outlined),
                          title: Text(context.tr('选择工作目录')),
                          subtitle: Text(
                            controller.draftCwd ?? context.tr('选择目录并开始新对话'),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: onChooseDirectory,
                        ),
                        const Divider(indent: 56),
                        ListTile(
                          leading: const Icon(Icons.auto_awesome_outlined),
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
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(
                                  color: Theme.of(context).colorScheme.outline,
                                ),
                          ),
                        ),
                        if (onSwitchServer != null) ...[
                          const SizedBox(width: 6),
                          Icon(
                            Icons.swap_horiz_rounded,
                            size: 16,
                            color: Theme.of(context).colorScheme.outline,
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
                    borderRadius: BorderRadius.circular(AppleRadius.panel),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      children: [
                        SwitchListTile(
                          value: dark,
                          onChanged: onThemeModeChanged == null
                              ? null
                              : (enabled) => onThemeModeChanged!(
                                  enabled ? ThemeMode.dark : ThemeMode.light,
                                ),
                          secondary: Icon(
                            dark
                                ? Icons.dark_mode_outlined
                                : Icons.light_mode_outlined,
                          ),
                          title: Text(context.tr(dark ? '深色模式' : '浅色模式')),
                          subtitle: Text(context.tr('立即切换 App 的显示外观')),
                        ),
                        const Divider(indent: 56),
                        SwitchListTile(
                          value: compactOutput,
                          onChanged: onCompactOutputChanged,
                          secondary: const Icon(Icons.compress_rounded),
                          title: Text(context.tr('简洁输出')),
                          subtitle: Text(context.tr('运行时隐藏中间过程，只显示最终答案')),
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
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
                const Spacer(),
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

  @override
  Widget build(BuildContext context) {
    final grouped = <String, List<PiSession>>{};
    final query = _query;
    for (final session in widget.controller.sessions) {
      final matchesQuery =
          query.isEmpty ||
          session.cwd.toLowerCase().contains(query) ||
          session.titleFor(context.appLanguage).toLowerCase().contains(query) ||
          session.id.toLowerCase().contains(query);
      if (matchesQuery) {
        grouped.putIfAbsent(session.cwd, () => []).add(session);
      }
    }
    final directories = grouped.keys.toList()
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
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
                        final name =
                            cwd
                                .split(RegExp(r'[/\\]'))
                                .where((part) => part.isNotEmpty)
                                .lastOrNull ??
                            cwd;
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
                              return ExpansionTile(
                                key: PageStorageKey(cwd),
                                initiallyExpanded: sessions.any(
                                  (session) =>
                                      session.id ==
                                      widget.controller.activeSessionId,
                                ),
                                leading: const Icon(Icons.folder_outlined),
                                title: Text(
                                  folderName ?? cwd,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
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
