import 'dart:convert';

import 'localization.dart';

class ServerProfile {
  ServerProfile({
    required this.baseUrl,
    required this.username,
    required this.password,
    String? id,
  }) : id = id ?? _idFor(baseUrl);

  final String baseUrl;
  final String username;
  final String password;

  /// Stable identity for multi-server storage. Derived from [baseUrl] when not
  /// provided explicitly so legacy single-profile code keeps working.
  final String id;

  static String _idFor(String baseUrl) =>
      'p${base64UrlEncode(utf8.encode(baseUrl)).replaceAll('=', '')}';

  ServerProfile copyWith({
    String? baseUrl,
    String? username,
    String? password,
    String? id,
  }) => ServerProfile(
    baseUrl: baseUrl ?? this.baseUrl,
    username: username ?? this.username,
    password: password ?? this.password,
    id: id ?? this.id,
  );

  @override
  bool operator ==(Object other) =>
      other is ServerProfile &&
      other.id == id &&
      other.baseUrl == baseUrl &&
      other.username == username;

  @override
  int get hashCode => Object.hash(id, baseUrl, username);
}

String normalizeServerUrl(
  String input, {
  AppLanguage language = AppLanguage.zhHans,
}) {
  var value = input.trim();
  if (value.isEmpty) {
    throw FormatException(AppLocalizations.text(language, '请输入服务器地址'));
  }
  if (!value.contains('://')) value = 'http://$value';
  final uri = Uri.tryParse(value);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
    throw FormatException(AppLocalizations.text(language, '服务器地址格式不正确'));
  }
  if (uri.scheme != 'http' && uri.scheme != 'https') {
    throw FormatException(
      AppLocalizations.text(language, '只支持 HTTP 或 HTTPS 地址'),
    );
  }
  final cleanPath = uri.path == '/'
      ? ''
      : uri.path.replaceFirst(RegExp(r'/+$'), '');
  return uri
      .replace(path: cleanPath, query: null, fragment: null)
      .toString()
      .replaceFirst(RegExp(r'/$'), '');
}

class PiSession {
  const PiSession({
    required this.id,
    required this.cwd,
    required this.created,
    required this.modified,
    required this.messageCount,
    required this.firstMessage,
    this.name,
    this.projectRoot,
    this.running = false,
  });

  factory PiSession.fromJson(
    Map<String, dynamic> json, {
    bool running = false,
  }) {
    return PiSession(
      id: json['id']?.toString() ?? '',
      cwd: json['cwd']?.toString() ?? '',
      created:
          DateTime.tryParse(json['created']?.toString() ?? '') ??
          DateTime.now(),
      modified:
          DateTime.tryParse(json['modified']?.toString() ?? '') ??
          DateTime.now(),
      messageCount: (json['messageCount'] as num?)?.toInt() ?? 0,
      firstMessage: json['firstMessage']?.toString() ?? '',
      name: json['name']?.toString(),
      projectRoot: json['projectRoot']?.toString(),
      running: running,
    );
  }

  final String id;
  final String cwd;
  final String? name;
  final DateTime created;
  final DateTime modified;
  final int messageCount;
  final String firstMessage;
  final String? projectRoot;
  final bool running;

  /// Shallow copy; only [running] is intended to change after creation.
  PiSession copyWith({bool? running}) => PiSession(
    id: id,
    cwd: cwd,
    created: created,
    modified: modified,
    messageCount: messageCount,
    firstMessage: firstMessage,
    name: name,
    projectRoot: projectRoot,
    running: running ?? this.running,
  );

  String get title {
    return titleFor(AppLanguage.zhHans);
  }

  String titleFor(AppLanguage language) {
    final named = name?.trim();
    if (named != null && named.isNotEmpty) return named;
    final first = firstMessage.trim();
    return first.isEmpty || first == '(no messages)'
        ? AppLocalizations.text(language, '新对话')
        : first;
  }
}

class PiModel {
  const PiModel({required this.provider, required this.id, required this.name});

  factory PiModel.fromJson(Map<String, dynamic> json) => PiModel(
    provider: json['provider']?.toString() ?? '',
    id: (json['modelId'] ?? json['id'])?.toString() ?? '',
    name: (json['name'] ?? json['modelId'] ?? json['id'])?.toString() ?? '',
  );

  final String provider;
  final String id;
  final String name;

  String get key => '$provider:$id';
  String get label => name == id ? id : '$name · $id';

  @override
  bool operator ==(Object other) =>
      other is PiModel && other.provider == provider && other.id == id;

  @override
  int get hashCode => Object.hash(provider, id);
}

class ModelCatalog {
  const ModelCatalog({required this.models, this.defaultModel});
  final List<PiModel> models;
  final PiModel? defaultModel;
}

/// A snippet (快捷输入) from the web client's `GET /api/snippets`.
class PiSnippet {
  const PiSnippet({required this.name, required this.content});

  factory PiSnippet.fromJson(Map<String, dynamic> json) => PiSnippet(
    name: json['name']?.toString() ?? '',
    content: json['content']?.toString() ?? '',
  );

  final String name;
  final String content;
}

/// A theme set from the web client's `GET /api/themes`.
class ThemeSet {
  const ThemeSet({
    required this.name,
    required this.displayName,
    required this.hasDark,
    required this.hasLight,
    required this.builtin,
    this.accent,
    this.accentLight,
  });

  factory ThemeSet.fromJson(Map<String, dynamic> json) => ThemeSet(
    name: json['name']?.toString() ?? '',
    displayName:
        json['displayName']?.toString() ?? json['name']?.toString() ?? '',
    hasDark: json['hasDark'] == true,
    hasLight: json['hasLight'] == true,
    builtin: json['builtin'] == true,
    accent: json['accent']?.toString(),
    accentLight: json['accentLight']?.toString(),
  );

  final String name;
  final String displayName;
  final bool hasDark;
  final bool hasLight;
  final bool builtin;
  final String? accent;
  final String? accentLight;
}

/// API-key provider auth status from the web client's
/// `GET /api/auth/all-providers` / `GET /api/auth/api-key/[provider]`.
class ProviderAuthStatus {
  const ProviderAuthStatus({
    required this.id,
    required this.displayName,
    required this.configured,
    this.source,
    this.modelCount = 0,
    this.supportsOAuth = false,
  });

  factory ProviderAuthStatus.fromJson(Map<String, dynamic> json) =>
      ProviderAuthStatus(
        id: json['id']?.toString() ?? '',
        displayName:
            json['displayName']?.toString() ?? json['name']?.toString() ?? '',
        configured: json['configured'] == true,
        source: json['source']?.toString(),
        modelCount: (json['modelCount'] as num?)?.toInt() ?? 0,
        supportsOAuth: json['supportsOAuth'] == true,
      );

  final String id;
  final String displayName;
  final bool configured;
  final String? source;
  final int modelCount;
  final bool supportsOAuth;
}

class PiSkill {
  const PiSkill({
    required this.name,
    required this.description,
    required this.filePath,
    required this.disableModelInvocation,
    this.source,
    this.scope,
  });

  factory PiSkill.fromJson(Map<String, dynamic> json) {
    final sourceInfo = json['sourceInfo'];
    return PiSkill(
      name: json['name']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      filePath: json['filePath']?.toString() ?? '',
      disableModelInvocation: json['disableModelInvocation'] == true,
      source: sourceInfo is Map ? sourceInfo['source']?.toString() : null,
      scope: sourceInfo is Map ? sourceInfo['scope']?.toString() : null,
    );
  }

  final String name;
  final String description;
  final String filePath;
  final bool disableModelInvocation;
  final String? source;
  final String? scope;

  String get sourceLabel {
    return sourceLabelFor(AppLanguage.zhHans);
  }

  String sourceLabelFor(AppLanguage language) {
    if (scope == 'project' || source == 'project') {
      return AppLocalizations.text(language, '项目');
    }
    if (scope == 'user' || source == 'user') {
      return AppLocalizations.text(language, '全局');
    }
    return AppLocalizations.text(language, '路径');
  }
}

class SkillCatalog {
  const SkillCatalog({
    required this.skills,
    required this.diagnostics,
    required this.projectResourcesLoaded,
  });

  final List<PiSkill> skills;
  final List<String> diagnostics;
  final bool projectResourcesLoaded;
}

class PiSlashCommand {
  const PiSlashCommand({
    required this.name,
    required this.description,
    required this.source,
  });

  factory PiSlashCommand.fromJson(Map<String, dynamic> json) => PiSlashCommand(
    name: json['name']?.toString() ?? '',
    description: json['description']?.toString() ?? '',
    source: json['source']?.toString() ?? 'extension',
  );

  final String name;
  final String description;
  final String source;

  bool get isSkill => source == 'skill';
  String get skillName =>
      name.startsWith('skill:') ? name.substring('skill:'.length) : name;

  String get sourceLabel => sourceLabelFor(AppLanguage.zhHans);

  String sourceLabelFor(AppLanguage language) =>
      AppLocalizations.text(language, switch (source) {
        'builtin' => '内置',
        'extension' => '扩展',
        'prompt' => '提示词',
        'skill' => '技能',
        _ => '其他',
      });
}

class BuiltinCommandResult {
  const BuiltinCommandResult({
    required this.handled,
    this.message,
    this.error,
    this.details,
    this.copyText,
  });

  final bool handled;
  final String? message;
  final String? error;
  final String? details;
  final String? copyText;
}

class DirectoryEntry {
  const DirectoryEntry({required this.name, required this.path});

  factory DirectoryEntry.fromJson(Map<String, dynamic> json) => DirectoryEntry(
    name: json['name']?.toString() ?? '',
    path: json['path']?.toString() ?? '',
  );

  final String name;
  final String path;
}

class DirectoryListing {
  const DirectoryListing({
    required this.path,
    required this.directories,
    this.parentPath,
  });

  final String path;
  final String? parentPath;
  final List<DirectoryEntry> directories;

  factory DirectoryListing.fromJson(
    Map<String, dynamic> json, {
    String fallbackPath = '',
  }) {
    final rawEntries = <dynamic>[
      ...?json['drives'] as List?,
      ...?json['directories'] as List?,
    ];
    final directories = rawEntries
        .map((value) {
          if (value is Map) {
            return DirectoryEntry.fromJson(Map<String, dynamic>.from(value));
          }
          final path = value?.toString() ?? '';
          final parts = path
              .split(RegExp(r'[/\\]'))
              .where((part) => part.isNotEmpty);
          return DirectoryEntry(
            name: parts.isEmpty ? path : parts.last,
            path: path,
          );
        })
        .where((entry) => entry.path.isNotEmpty)
        .toList();
    return DirectoryListing(
      path: json['path']?.toString() ?? fallbackPath,
      parentPath: json['parentPath']?.toString(),
      directories: directories,
    );
  }
}

class SessionSnapshot {
  const SessionSnapshot({required this.messages, this.model});
  final List<ChatMessage> messages;
  final PiModel? model;
}

class GitFileStatus {
  const GitFileStatus({
    required this.filePath,
    required this.status,
    this.indexStatus,
    this.worktreeStatus,
  });

  factory GitFileStatus.fromJson(Map<String, dynamic> json) => GitFileStatus(
    filePath: json['filePath']?.toString() ?? '',
    status: json['status']?.toString() ?? 'unknown',
    indexStatus: json['indexStatus']?.toString(),
    worktreeStatus: json['worktreeStatus']?.toString(),
  );

  final String filePath;
  final String status;
  final String? indexStatus;
  final String? worktreeStatus;

  String get fileName => filePath.split(RegExp(r'[/\\]')).last;
}

class GitStatus {
  const GitStatus({
    required this.isGitRepository,
    required this.files,
    required this.additions,
    required this.deletions,
    this.repositoryRoot,
  });

  factory GitStatus.fromJson(Map<String, dynamic> json) => GitStatus(
    isGitRepository: json['isGitRepository'] == true,
    repositoryRoot: json['repositoryRoot']?.toString(),
    files: (json['files'] as List? ?? const [])
        .whereType<Map>()
        .map(
          (value) => GitFileStatus.fromJson(Map<String, dynamic>.from(value)),
        )
        .toList(),
    additions: (json['additions'] as num?)?.toInt() ?? 0,
    deletions: (json['deletions'] as num?)?.toInt() ?? 0,
  );

  final bool isGitRepository;
  final String? repositoryRoot;
  final List<GitFileStatus> files;
  final int additions;
  final int deletions;
}

class PiImageAttachment {
  const PiImageAttachment({required this.data, required this.mimeType});

  final String data;
  final String mimeType;

  Map<String, dynamic> toJson() => {
    'type': 'image',
    'data': data,
    'mimeType': mimeType,
  };
}

class PiToolCall {
  const PiToolCall({required this.name, this.toolCallId, this.arguments});

  final String name;
  final String? toolCallId;

  /// Structured tool arguments; kept separate from the flattened
  /// [ChatMessage.processText] so the UI can render collapsible tool cards
  /// with argument previews like the web client.
  final Map<String, dynamic>? arguments;

  /// Single-line preview of the most meaningful argument, mirroring the web
  /// client's `getToolPreview` (command/path/pattern/query first).
  String get preview {
    final args = arguments;
    if (args == null || args.isEmpty) return '';
    for (final key in const [
      'command',
      'path',
      'pattern',
      'query',
      'name',
      'file',
      'text',
    ]) {
      final value = args[key];
      if (value is String && value.trim().isNotEmpty) {
        return value.trim();
      }
      if (value is List && value.isNotEmpty) {
        return value.map((item) => item.toString()).join(', ');
      }
    }
    return args.values.map((v) => v.toString()).join(', ');
  }
}

class ChatMessage {
  const ChatMessage({
    required this.role,
    required this.text,
    this.thinking = '',
    this.processText = '',
    this.toolCallCount = 0,
    this.toolCalls = const [],
    this.toolName,
    this.isError = false,
    this.queued = false,
    this.thinkingEntryId,
    this.thinkingBlockIndex,
    this.raw,
  });

  factory ChatMessage.fromJson(
    Map<String, dynamic> json, {
    AppLanguage language = AppLanguage.zhHans,
  }) {
    final role = json['role']?.toString() ?? 'custom';
    final errorMessage = json['errorMessage']?.toString();
    final content = parseMessageContent(json, language: language);
    return ChatMessage(
      role: role,
      text:
          content.text.isEmpty &&
              errorMessage != null &&
              errorMessage.isNotEmpty
          ? '${AppLocalizations.text(language, '模型请求失败：')}\n\n$errorMessage'
          : content.text,
      thinking: content.thinking,
      processText: content.processText,
      toolCallCount: content.toolCallCount,
      toolCalls: content.toolCalls,
      toolName: json['toolName']?.toString(),
      isError: json['isError'] == true,
      thinkingEntryId: content.thinkingEntryId,
      thinkingBlockIndex: content.thinkingBlockIndex,
      raw: json,
    );
  }

  final String role;
  final String text;
  final String thinking;
  final String processText;
  final int toolCallCount;
  final List<PiToolCall> toolCalls;
  final String? toolName;
  final bool isError;

  /// Local-only marker for messages enqueued while the agent is running
  /// (steer / follow-up). Renders with a ⏳ badge until the run settles and
  /// the real message history replaces the placeholder.
  final bool queued;

  /// Lazily-loaded thinking: when the server defers historical thinking, the
  /// entry/block reference lets the client fetch it on demand via
  /// `/api/sessions/[id]/entries/[entryId]/thinking?blockIndex=N`.
  final String? thinkingEntryId;
  final int? thinkingBlockIndex;
  final Map<String, dynamic>? raw;

  ChatMessage copyWith({
    String? text,
    String? thinking,
    String? processText,
    List<PiToolCall>? toolCalls,
    String? thinkingEntryId,
    int? thinkingBlockIndex,
    bool? queued,
  }) => ChatMessage(
    role: role,
    text: text ?? this.text,
    thinking: thinking ?? this.thinking,
    processText: processText ?? this.processText,
    toolCallCount: toolCallCount,
    toolCalls: toolCalls ?? this.toolCalls,
    toolName: toolName,
    isError: isError,
    queued: queued ?? this.queued,
    thinkingEntryId: thinkingEntryId ?? this.thinkingEntryId,
    thinkingBlockIndex: thinkingBlockIndex ?? this.thinkingBlockIndex,
    raw: raw,
  );
}

class ParsedMessageContent {
  const ParsedMessageContent({
    required this.text,
    required this.thinking,
    required this.processText,
    required this.toolCallCount,
    this.toolCalls = const [],
    this.thinkingEntryId,
    this.thinkingBlockIndex,
  });
  final String text;
  final String thinking;
  final String processText;
  final int toolCallCount;
  final List<PiToolCall> toolCalls;

  /// Reference for deferred thinking blocks (pi-web-QT `deferThinking`).
  final String? thinkingEntryId;
  final int? thinkingBlockIndex;
}

ParsedMessageContent parseMessageContent(
  Map<String, dynamic> message, {
  AppLanguage language = AppLanguage.zhHans,
}) {
  if (message['role'] == 'bashExecution') {
    return ParsedMessageContent(
      text: [
        message['command'],
        message['output'],
      ].whereType<String>().where((value) => value.isNotEmpty).join('\n'),
      thinking: '',
      processText: '',
      toolCallCount: 0,
    );
  }
  final content = message['content'];
  if (content is String) {
    return ParsedMessageContent(
      text: content,
      thinking: '',
      processText: '',
      toolCallCount: 0,
    );
  }
  if (content is! List) {
    return const ParsedMessageContent(
      text: '',
      thinking: '',
      processText: '',
      toolCallCount: 0,
    );
  }
  final parts = <String>[];
  final thinkingParts = <String>[];
  final processParts = <String>[];
  final toolCalls = <PiToolCall>[];
  var toolCallCount = 0;
  String? thinkingEntryId;
  int? thinkingBlockIndex;
  for (final item in content) {
    if (item is! Map) continue;
    final block = Map<String, dynamic>.from(item);
    switch (block['type']) {
      case 'text':
        final text = block['text']?.toString() ?? '';
        if (text.isNotEmpty) parts.add(text);
      case 'thinking':
        final thinking =
            (block['thinking'] ?? block['text'])?.toString().trim() ?? '';
        if (thinking.isNotEmpty) {
          thinkingParts.add(thinking);
        } else if (thinkingEntryId == null) {
          // Deferred thinking: remember the block reference so the UI can
          // fetch it lazily via the per-entry thinking endpoint. The block id
          // is `<entryId>:<blockIndex>`.
          final id = block['id']?.toString() ?? '';
          final separator = id.lastIndexOf(':');
          if (separator > 0 && separator < id.length - 1) {
            final entryId = id.substring(0, separator);
            final index = int.tryParse(id.substring(separator + 1));
            if (entryId.isNotEmpty && index != null) {
              thinkingEntryId = entryId;
              thinkingBlockIndex = index;
            }
          }
        }
      case 'toolCall':
        final name = block['toolName'] ?? block['name'] ?? 'tool';
        toolCalls.add(
          PiToolCall(
            name: name.toString(),
            toolCallId: block['id']?.toString(),
            arguments: block['arguments'] is Map
                ? Map<String, dynamic>.from(
                    Map<String, dynamic>.from(block['arguments'] as Map),
                  )
                : null,
          ),
        );
        processParts.add(
          AppLocalizations.text(language, '调用工具：`{name}`', {'name': name}),
        );
        toolCallCount += 1;
      case 'image':
        parts.add(AppLocalizations.text(language, '[图片]'));
    }
  }
  return ParsedMessageContent(
    text: parts.join('\n\n'),
    thinking: thinkingParts.join('\n\n'),
    processText: processParts.join('\n\n'),
    toolCallCount: toolCallCount,
    toolCalls: toolCalls,
    thinkingEntryId: thinkingEntryId,
    thinkingBlockIndex: thinkingBlockIndex,
  );
}

String messageText(Map<String, dynamic> message) =>
    parseMessageContent(message).text;

String messageThinking(Map<String, dynamic> message) =>
    parseMessageContent(message).thinking;

String messageProcessText(Map<String, dynamic> message) =>
    parseMessageContent(message).processText;

/// Work-task status mirroring the web client's `WorkTaskStatus`
/// (lib/task-types.ts).
enum TaskStatus {
  todo,
  queued,
  preparing,
  running,
  awaitingInput,
  review,
  merging,
  done,
  failed,
  canceled,
  unknown;

  static TaskStatus parse(String? value) => switch (value) {
    'todo' => TaskStatus.todo,
    'queued' => TaskStatus.queued,
    'preparing' => TaskStatus.preparing,
    'running' => TaskStatus.running,
    'awaiting_input' => TaskStatus.awaitingInput,
    'review' => TaskStatus.review,
    'merging' => TaskStatus.merging,
    'done' => TaskStatus.done,
    'failed' => TaskStatus.failed,
    'canceled' => TaskStatus.canceled,
    _ => TaskStatus.unknown,
  };

  /// Tasks shown under the “in progress” segment.
  bool get isActive => switch (this) {
    TaskStatus.queued ||
    TaskStatus.preparing ||
    TaskStatus.running ||
    TaskStatus.awaitingInput ||
    TaskStatus.review ||
    TaskStatus.merging => true,
    _ => false,
  };

  bool get isFinished => switch (this) {
    TaskStatus.done || TaskStatus.failed || TaskStatus.canceled => true,
    _ => false,
  };
}

/// A work task from the web client's `/api/tasks` endpoints (mirrors
/// `WorkTask` in lib/task-types.ts — camelCase wire form).
class PiTask {
  const PiTask({
    required this.id,
    required this.projectRoot,
    required this.title,
    required this.status,
    this.modelId,
    this.conversationId,
    this.createdAt,
    this.finishedAt,
    this.filesChanged,
    this.additions,
    this.deletions,
    this.failureReason,
  });

  final int id;
  final String projectRoot;
  final String title;
  final TaskStatus status;
  final String? modelId;
  final String? conversationId;
  final DateTime? createdAt;
  final DateTime? finishedAt;
  final int? filesChanged;
  final int? additions;
  final int? deletions;
  final String? failureReason;

  factory PiTask.fromJson(Map<String, dynamic> json) {
    final config = json['config'];
    final modelId = config is Map ? config['modelId']?.toString() : null;
    return PiTask(
      id: (json['id'] as num?)?.toInt() ?? 0,
      projectRoot: json['projectRoot']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      status: TaskStatus.parse(json['status']?.toString()),
      modelId: modelId,
      conversationId: json['conversationId']?.toString(),
      createdAt: DateTime.tryParse(
        json['createdAt']?.toString() ?? '',
      ),
      finishedAt: DateTime.tryParse(
        json['finishedAt']?.toString() ?? '',
      ),
      filesChanged: (json['filesChanged'] as num?)?.toInt(),
      additions: (json['additions'] as num?)?.toInt(),
      deletions: (json['deletions'] as num?)?.toInt(),
      failureReason: json['failureReason']?.toString(),
    );
  }
}
