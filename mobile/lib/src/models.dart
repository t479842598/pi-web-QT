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

class ChatMessage {
  const ChatMessage({
    required this.role,
    required this.text,
    this.thinking = '',
    this.processText = '',
    this.toolCallCount = 0,
    this.toolName,
    this.isError = false,
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
  final String? toolName;
  final bool isError;

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
    String? thinkingEntryId,
    int? thinkingBlockIndex,
  }) => ChatMessage(
    role: role,
    text: text ?? this.text,
    thinking: thinking ?? this.thinking,
    processText: processText ?? this.processText,
    toolCallCount: toolCallCount,
    toolName: toolName,
    isError: isError,
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
    this.thinkingEntryId,
    this.thinkingBlockIndex,
  });
  final String text;
  final String thinking;
  final String processText;
  final int toolCallCount;

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
