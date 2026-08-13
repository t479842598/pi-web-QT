import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'models.dart';
import 'localization.dart';

class PiApiException implements Exception {
  const PiApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class PiApi {
  PiApi(this.profile, {this.language = AppLanguage.zhHans})
    : _client = http.Client();

  final ServerProfile profile;
  final http.Client _client;
  AppLanguage language;

  void setLanguage(AppLanguage value) => language = value;
  String _tr(String source, [Map<String, Object?> values = const {}]) =>
      AppLocalizations.text(language, source, values);

  String get _authorization =>
      'Basic ${base64Encode(utf8.encode('${profile.username}:${profile.password}'))}';

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = Uri.parse(profile.baseUrl);
    final basePath = base.path == '/' ? '' : base.path;
    return base.replace(path: '$basePath$path', queryParameters: query);
  }

  /// pi-web-QT's request-security middleware rejects write requests without an
  /// Origin header (403). We mirror the request host so native clients pass
  /// the same-origin check. Safe to attach for every method.
  Map<String, String> get _headers => {
    if (profile.password.isNotEmpty)
      HttpHeaders.authorizationHeader: _authorization,
    HttpHeaders.acceptHeader: 'application/json',
    'Origin': Uri.parse(profile.baseUrl).origin,
  };

  Future<Map<String, dynamic>> _decode(http.Response response) async {
    dynamic body;
    try {
      body = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      body = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final fallback = switch (response.statusCode) {
        401 => _tr('账号或密码错误'),
        403 => _tr(
          '服务器拒绝了该请求（403）。若使用域名连接，请确认已在服务器的 PI_WEB_ALLOWED_HOSTS 中放行该域名。',
        ),
        _ => _tr('服务器请求失败（HTTP {status}）', {'status': response.statusCode}),
      };
      final message = body is Map ? body['error']?.toString() : null;
      if (message == null || message.isEmpty) {
        throw PiApiException(fallback, statusCode: response.statusCode);
      }
      // Surface a short response excerpt alongside the server's error text so
      // protocol mismatches are debuggable instead of a bare HTTP status.
      final bodyText = utf8.decode(response.bodyBytes, allowMalformed: true);
      final excerpt = bodyText.trim().replaceAll(RegExp(r'\s+'), ' ');
      final detail = excerpt.isNotEmpty && excerpt.length > 4
          ? '$message（$excerpt）'
          : message;
      throw PiApiException(detail, statusCode: response.statusCode);
    }
    if (body is! Map) {
      final bodyText = utf8.decode(response.bodyBytes, allowMalformed: true);
      final excerpt = bodyText.trim();
      throw PiApiException(
        excerpt.isEmpty ? _tr('服务器未返回数据，请稍后重试') : _tr('服务器返回了无法识别的数据'),
      );
    }
    return Map<String, dynamic>.from(body);
  }

  Future<List<PiSession>> getSessions() async {
    final response = await _client
        .get(_uri('/api/sessions'), headers: _headers)
        .timeout(const Duration(seconds: 15));
    final body = await _decode(response);
    final runningList = body['runningSessionIds'];
    final running = (runningList is List ? runningList : const [])
        .map((e) => e.toString())
        .toSet();
    return (body['sessions'] as List? ?? const []).whereType<Map>().map((
      value,
    ) {
      final json = Map<String, dynamic>.from(value);
      return PiSession.fromJson(
        json,
        running: running.contains(json['id']?.toString()),
      );
    }).toList();
  }

  Future<SessionSnapshot> getSession(String sessionId) async {
    final response = await _client
        .get(
          _uri('/api/sessions/${Uri.encodeComponent(sessionId)}', {
            'deferThinking': '1',
            'deferMedia': '1',
          }),
          headers: _headers,
        )
        .timeout(const Duration(seconds: 20));
    final body = await _decode(response);
    final context = body['context'];
    final messages = context is Map ? context['messages'] : null;
    final entryIds = context is Map ? context['entryIds'] : null;
    final parsedEntries = (messages as List? ?? const []).whereType<Map>();
    final parsedMessages = <ChatMessage>[];
    var entryIndex = 0;
    for (final value in parsedEntries) {
      final entryId = (entryIds as List? ?? const [])
          .elementAtOrNull(entryIndex)
          ?.toString();
      entryIndex += 1;
      parsedMessages.add(
        ChatMessage.fromJson(
          Map<String, dynamic>.from(value),
          language: language,
          entryId: entryId,
        ),
      );
    }
    final modelJson = context is Map ? context['model'] : null;
    return SessionSnapshot(
      messages: parsedMessages,
      model: modelJson is Map
          ? PiModel.fromJson(Map<String, dynamic>.from(modelJson))
          : null,
    );
  }

  /// Lazily loads a deferred thinking block for an assistant entry.
  Future<String> getEntryThinking(
    String sessionId,
    String entryId,
    int blockIndex,
  ) async {
    final response = await _client
        .get(
          _uri(
            '/api/sessions/${Uri.encodeComponent(sessionId)}'
            '/entries/${Uri.encodeComponent(entryId)}/thinking',
            {'blockIndex': '$blockIndex'},
          ),
          headers: _headers,
        )
        .timeout(const Duration(seconds: 15));
    final body = await _decode(response);
    return body['thinking']?.toString() ?? '';
  }

  /// Git working-tree status for a directory (read-only).
  Future<GitStatus> getGitStatus(String cwd) async {
    final response = await _client
        .get(_uri('/api/git/status', {'cwd': cwd}), headers: _headers)
        .timeout(const Duration(seconds: 20));
    final body = await _decode(response);
    return GitStatus.fromJson(body);
  }

  /// 列出项目的 Git Worktree（GET /api/worktrees?cwd=）。
  Future<Map<String, dynamic>> getWorktrees(String cwd) async {
    final response = await _client
        .get(_uri('/api/worktrees', {'cwd': cwd}), headers: _headers)
        .timeout(const Duration(seconds: 20));
    return await _decode(response);
  }

  /// 创建 Git Worktree（POST /api/worktrees，body {cwd, branch}）。
  Future<Map<String, dynamic>> createWorktree(
    String cwd,
    String branch,
  ) async {
    return post('/api/worktrees', {'cwd': cwd, 'branch': branch});
  }

  /// 移除 Git Worktree（DELETE /api/worktrees?cwd=&path=）。
  Future<void> removeWorktree(String cwd, String path) async {
    final uri = _uri('/api/worktrees', {'cwd': cwd, 'path': path});
    final response = await _client
        .delete(uri, headers: _headers)
        .timeout(const Duration(seconds: 20));
    await _decode(response);
  }

  /// 读取 MCP 服务器配置（GET /api/mcp）。
  Future<Map<String, dynamic>> getMcpServers() async {
    final response = await _client
        .get(_uri('/api/mcp'), headers: _headers)
        .timeout(const Duration(seconds: 20));
    return await _decode(response);
  }

  /// 全量替换 MCP 服务器配置（PUT /api/mcp，body {mcpServers}）。
  Future<void> putMcpServers(Map<String, dynamic> mcpServers) async {
    final response = await _client
        .put(
          _uri('/api/mcp'),
          headers: {
            ..._headers,
            HttpHeaders.contentTypeHeader: 'application/json',
          },
          body: jsonEncode({'mcpServers': mcpServers}),
        )
        .timeout(const Duration(seconds: 20));
    await _decode(response);
  }

  /// 重启 MCP 服务器（POST /api/mcp/restart）。
  Future<void> restartMcp() async {
    await post('/api/mcp/restart', {});
  }

  /// Single-file diff against HEAD (read-only). The server marks unsupported
  /// files with `supported: false` instead of failing.
  Future<String> getGitFileDiff(String cwd, String filePath) async {
    final response = await _client
        .get(
          _uri('/api/git/diff', {'cwd': cwd, 'path': filePath}),
          headers: _headers,
        )
        .timeout(const Duration(seconds: 20));
    final body = await _decode(response);
    final diff = body['diff']?.toString();
    if (diff == null || diff.isEmpty) {
      throw PiApiException(_tr('无法读取该文件的变更'));
    }
    return diff;
  }

  Future<ModelCatalog> getModels(String cwd) async {
    final response = await _client
        .get(_uri('/api/models', {'cwd': cwd}), headers: _headers)
        .timeout(const Duration(seconds: 25));
    final body = await _decode(response);
    final models = (body['modelList'] as List? ?? const [])
        .whereType<Map>()
        .map((value) => PiModel.fromJson(Map<String, dynamic>.from(value)))
        .where((model) => model.provider.isNotEmpty && model.id.isNotEmpty)
        .toList();
    final defaultJson = body['defaultModel'];
    PiModel? defaultModel;
    if (defaultJson is Map) {
      final value = PiModel.fromJson(Map<String, dynamic>.from(defaultJson));
      defaultModel =
          models.where((model) => model == value).firstOrNull ?? value;
    }
    return ModelCatalog(models: models, defaultModel: defaultModel);
  }

  Future<SkillCatalog> getSkills(String cwd) async {
    final response = await _client
        .get(_uri('/api/skills', {'cwd': cwd}), headers: _headers)
        .timeout(const Duration(seconds: 25));
    final body = await _decode(response);
    final skills =
        (body['skills'] as List? ?? const [])
            .whereType<Map>()
            .map((value) => PiSkill.fromJson(Map<String, dynamic>.from(value)))
            .where((skill) => skill.name.isNotEmpty)
            .toList()
          ..sort(
            (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
          );
    final diagnostics = (body['diagnostics'] as List? ?? const [])
        .map((value) {
          if (value is Map) {
            return (value['message'] ?? value['error'] ?? value).toString();
          }
          return value.toString();
        })
        .where((value) => value.isNotEmpty)
        .toList();
    return SkillCatalog(
      skills: skills,
      diagnostics: diagnostics,
      projectResourcesLoaded: body['projectResourcesLoaded'] != false,
    );
  }

  Future<DirectoryListing> browseDirectories([String? path]) async {
    final response = await _client
        .get(
          _uri('/api/cwd/browse', {
            if (path != null && path.trim().isNotEmpty) 'path': path.trim(),
          }),
          headers: _headers,
        )
        .timeout(const Duration(seconds: 15));
    final body = await _decode(response);
    return DirectoryListing.fromJson(body, fallbackPath: path ?? '');
  }

  Future<String> createDirectory(String parentPath, String name) async {
    final body = await post('/api/cwd/browse', {
      'parentPath': parentPath,
      'name': name,
    });
    final path = body['path']?.toString() ?? '';
    if (path.isEmpty) throw PiApiException(_tr('服务器没有返回新目录路径'));
    return path;
  }

  Future<String> createSession(String cwd, {PiModel? model}) async {
    final body = await post('/api/agent/new', {
      'cwd': cwd,
      'type': 'ensure_session',
      if (model != null) 'provider': model.provider,
      if (model != null) 'modelId': model.id,
    });
    final id = body['sessionId']?.toString();
    if (id == null || id.isEmpty) {
      throw PiApiException(_tr('服务器没有返回会话 ID'));
    }
    return id;
  }

  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> payload, {
    Duration timeout = const Duration(seconds: 20),
    Map<String, String>? query,
  }) async {
    final response = await _client
        .post(
          _uri(path, query),
          headers: {
            ..._headers,
            HttpHeaders.contentTypeHeader: 'application/json',
          },
          body: jsonEncode(payload),
        )
        .timeout(timeout);
    return _decode(response);
  }

  Future<void> deleteSession(String sessionId) async {
    final response = await _client
        .delete(
          _uri('/api/sessions/${Uri.encodeComponent(sessionId)}'),
          headers: _headers,
        )
        .timeout(const Duration(seconds: 20));
    await _decode(response);
  }

  Future<dynamic> sendAgentCommand(
    String sessionId,
    Map<String, dynamic> command, {
    Duration timeout = const Duration(seconds: 20),
  }) async {
    final body = await post(
      '/api/agent/${Uri.encodeComponent(sessionId)}',
      command,
      timeout: timeout,
    );
    return body['data'];
  }

  /// Raw GET returning a decoded map, or null on failure. Used for endpoints
  /// that have no dedicated typed accessor (e.g. `/api/modes`).
  Future<Map<String, dynamic>?> getRaw(Uri uri) async {
    try {
      final response = await _client
          .get(uri, headers: _headers)
          .timeout(const Duration(seconds: 10));
      if (response.statusCode < 200 || response.statusCode >= 300) return null;
      dynamic body;
      try {
        body = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        return null;
      }
      return body is Map ? Map<String, dynamic>.from(body) : null;
    } catch (_) {
      return null;
    }
  }

  /// Project display aliases (备注) keyed by directory path. Mirrors the web
  /// client's `GET /api/project-aliases`.
  Future<Map<String, String>> getProjectAliases() async {
    try {
      final response = await _client
          .get(_uri('/api/project-aliases'), headers: _headers)
          .timeout(const Duration(seconds: 12));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return const {};
      }
      dynamic body;
      try {
        body = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        return const {};
      }
      final aliases = body is Map ? body['aliases'] : null;
      if (aliases is! Map) return const {};
      return aliases.map(
        (key, value) => MapEntry(key.toString(), value?.toString() ?? ''),
      );
    } catch (_) {
      return const {};
    }
  }

  /// Sets (non-empty) or removes (empty) the display alias for a directory.
  /// Mirrors the web client's `PUT /api/project-aliases`.
  Future<bool> setProjectAlias(String cwd, String alias) async {
    try {
      final response = await _client
          .put(
            _uri('/api/project-aliases'),
            headers: {
              ..._headers,
              HttpHeaders.contentTypeHeader: 'application/json',
            },
            body: jsonEncode({'cwd': cwd, 'alias': alias.trim()}),
          )
          .timeout(const Duration(seconds: 12));
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      return false;
    }
  }

  /// Lists API-key-capable providers (auth status, never the raw key).
  /// Mirrors the web client's `GET /api/auth/all-providers`.
  Future<List<ProviderAuthStatus>> getApiKeyProviders() async {
    try {
      final response = await _client
          .get(_uri('/api/auth/all-providers'), headers: _headers)
          .timeout(const Duration(seconds: 15));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return const [];
      }
      dynamic body;
      try {
        body = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        return const [];
      }
      final providers = body is Map ? body['providers'] : null;
      if (providers is! List) return const [];
      return providers
          .whereType<Map>()
          .map(
            (value) =>
                ProviderAuthStatus.fromJson(Map<String, dynamic>.from(value)),
          )
          .where((provider) => provider.id.isNotEmpty)
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// Fetches auth status for a single provider (never the raw key).
  Future<ProviderAuthStatus?> getProviderAuthStatus(String provider) async {
    final providers = await getApiKeyProviders();
    for (final item in providers) {
      if (item.id == provider) return item;
    }
    return null;
  }

  /// Stores an API key for a provider.
  Future<bool> setProviderApiKey(String provider, String apiKey) async {
    try {
      final response = await _client
          .post(
            _uri('/api/auth/api-key/${Uri.encodeComponent(provider)}'),
            headers: {
              ..._headers,
              HttpHeaders.contentTypeHeader: 'application/json',
            },
            body: jsonEncode({'apiKey': apiKey}),
          )
          .timeout(const Duration(seconds: 30));
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      return false;
    }
  }

  /// Removes the stored API key for a provider.
  Future<bool> deleteProviderApiKey(String provider) async {
    try {
      final response = await _client
          .delete(
            _uri('/api/auth/api-key/${Uri.encodeComponent(provider)}'),
            headers: _headers,
          )
          .timeout(const Duration(seconds: 15));
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      return false;
    }
  }

  /// Lists available theme sets (web client's `GET /api/themes`).
  Future<List<ThemeSet>> getThemes() async {
    try {
      final response = await _client
          .get(_uri('/api/themes'), headers: _headers)
          .timeout(const Duration(seconds: 15));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return const [];
      }
      dynamic body;
      try {
        body = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        return const [];
      }
      final themeSets = body is Map ? body['themeSets'] : null;
      if (themeSets is! List) return const [];
      return themeSets
          .whereType<Map>()
          .map((value) => ThemeSet.fromJson(Map<String, dynamic>.from(value)))
          .where((theme) => theme.name.isNotEmpty)
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// Resolves a theme variant's CSS variables (`GET /api/themes/[name]`).
  /// Returns a map of CSS var name (without `--` prefix) → hex value.
  Future<Map<String, String>?> getThemeVars(
    String name, {
    bool dark = true,
  }) async {
    try {
      final uri = _uri('/api/themes/${Uri.encodeComponent(name)}', {
        'mode': dark ? 'dark' : 'light',
      });
      final response = await _client
          .get(uri, headers: _headers)
          .timeout(const Duration(seconds: 15));
      if (response.statusCode < 200 || response.statusCode >= 300) return null;
      dynamic body;
      try {
        body = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        return null;
      }
      if (body is! Map) return null;
      final cssVars = body['cssVars'];
      if (cssVars is! Map) return null;
      final result = <String, String>{};
      cssVars.forEach((key, value) {
        final clean = key.toString().replaceFirst('--', '');
        final str = value?.toString() ?? '';
        if (str.isNotEmpty && str.startsWith('#')) {
          result[clean] = str;
        }
      });
      return result;
    } catch (_) {
      return null;
    }
  }

  /// File index for `@` autocomplete (web client's `GET /api/file-index`).
  /// Returns relative file paths plus a truncated flag.
  Future<List<String>> getFileIndex(String cwd) async {
    try {
      final response = await _client
          .get(_uri('/api/file-index', {'cwd': cwd}), headers: _headers)
          .timeout(const Duration(seconds: 15));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return const [];
      }
      dynamic body;
      try {
        body = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        return const [];
      }
      final files = body is Map ? body['files'] : null;
      if (files is! List) return const [];
      return files
          .map((value) => value?.toString() ?? '')
          .where((path) => path.isNotEmpty)
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// Snippets (快捷输入) for `#` autocomplete (web client's `GET /api/snippets`).
  Future<List<PiSnippet>> getSnippets() async {
    try {
      final response = await _client
          .get(_uri('/api/snippets'), headers: _headers)
          .timeout(const Duration(seconds: 12));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return const [];
      }
      dynamic body;
      try {
        body = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        return const [];
      }
      final snippets = body is Map ? body['snippets'] : null;
      if (snippets is! List) return const [];
      return snippets
          .whereType<Map>()
          .map((value) => PiSnippet.fromJson(Map<String, dynamic>.from(value)))
          .where((snippet) => snippet.name.isNotEmpty)
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// Raw JSON PUT returning success/failure. Used for endpoints without a
  /// dedicated typed accessor (e.g. `/api/modes`).
  Future<bool> putJson(Uri uri, Map<String, dynamic> payload) async {
    try {
      final response = await _client
          .put(
            uri,
            headers: {
              ..._headers,
              HttpHeaders.contentTypeHeader: 'application/json',
            },
            body: jsonEncode(payload),
          )
          .timeout(const Duration(seconds: 10));
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      return false;
    }
  }

  /// Lightweight state probe for a session. Returns the full `get_state`
  /// payload when the RPC wrapper is alive, or `{running: false}` when it is
  /// not. HTTP errors / timeouts are treated as "unknown" (returns null).
  Future<Map<String, dynamic>?> getAgentState(String sessionId) async {
    try {
      final response = await _client
          .get(
            _uri('/api/agent/${Uri.encodeComponent(sessionId)}'),
            headers: _headers,
          )
          .timeout(const Duration(seconds: 8));
      if (response.statusCode < 200 || response.statusCode >= 300) return null;
      dynamic body;
      try {
        body = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        return null;
      }
      if (body is! Map) return null;
      return Map<String, dynamic>.from(body);
    } catch (_) {
      return null;
    }
  }

  Future<List<PiSlashCommand>> getSlashCommands(String sessionId) async {
    final data = await sendAgentCommand(sessionId, {'type': 'get_commands'});
    final commands = data is Map ? data['commands'] : null;
    return (commands as List? ?? const [])
        .whereType<Map>()
        .map(
          (value) => PiSlashCommand.fromJson(Map<String, dynamic>.from(value)),
        )
        .where((command) => command.name.isNotEmpty)
        .toList();
  }

  Future<void> sendPrompt(
    String sessionId,
    String message, {
    List<PiImageAttachment> images = const [],
    String? streamingBehavior,
  }) async {
    await post('/api/agent/${Uri.encodeComponent(sessionId)}', {
      'type': 'prompt',
      'message': message,
      if (images.isNotEmpty)
        'images': images.map((image) => image.toJson()).toList(),
      'streamingBehavior': ?streamingBehavior,
    });
  }

  Future<void> setModel(String sessionId, PiModel model) async {
    await post('/api/agent/${Uri.encodeComponent(sessionId)}', {
      'type': 'set_model',
      'provider': model.provider,
      'modelId': model.id,
    });
  }

  Future<void> abort(String sessionId) async {
    await post('/api/agent/${Uri.encodeComponent(sessionId)}', {
      'type': 'abort',
    });
  }

  /// Fork 一个会话：以指定消息 entryId 为分支点创建新会话，返回新会话 id。
  Future<String?> forkSession(String sessionId, String entryId) async {
    final data = await sendAgentCommand(sessionId, {
      'type': 'fork',
      'entryId': entryId,
    });
    if (data is Map) {
      final id = data['newSessionId']?.toString();
      if (id != null && id.isNotEmpty) return id;
    }
    return null;
  }

  /// 切换到会话的另一个分支（navigate_tree）。
  Future<void> navigateTree(String sessionId, String targetId) async {
    await sendAgentCommand(sessionId, {
      'type': 'navigate_tree',
      'targetId': targetId,
    });
  }

  Future<Stream<Map<String, dynamic>>> events(String sessionId) async {
    final request = http.Request(
      'GET',
      _uri('/api/agent/${Uri.encodeComponent(sessionId)}/events'),
    );
    request.headers.addAll({
      ..._headers,
      HttpHeaders.acceptHeader: 'text/event-stream',
    });
    final response = await _client
        .send(request)
        .timeout(const Duration(seconds: 12));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final text = await response.stream.bytesToString();
      throw PiApiException(
        response.statusCode == 401
            ? _tr('账号或密码错误')
            : (text.isEmpty ? _tr('事件流连接失败') : text),
        statusCode: response.statusCode,
      );
    }
    return response.stream
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .where((line) => line.startsWith('data:'))
        .map((line) {
          final data = line.substring(5).trim();
          if (data.isEmpty) return null;
          try {
            return jsonDecode(data);
          } catch (_) {
            // A proxy or misbehaving server may interleave non-JSON payloads
            // (heartbeat comments, HTML error pages). Skip the line instead of
            // crashing the whole stream.
            return null;
          }
        })
        .where((value) => value is Map)
        .map((value) => Map<String, dynamic>.from(value as Map));
  }

  // ── Work tasks (/api/tasks*) ────────────────────────────────────────

  /// All tasks for a project root (or all projects when omitted).
  Future<List<PiTask>> listTasks({String? projectRoot}) async {
    final data = await _decode(
      await _client.get(
        _uri('/api/tasks', {
          if (projectRoot != null && projectRoot.isNotEmpty)
            'projectRoot': projectRoot,
        }),
        headers: _headers,
      ).timeout(const Duration(seconds: 20)),
    );
    final tasks = data['tasks'];
    if (tasks is! List) return const [];
    return tasks
        .whereType<Map>()
        .map((e) => PiTask.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  /// All project roots that currently have tasks.
  Future<List<String>> listTaskProjects() async {
    final data = await _decode(
      await _client
          .get(_uri('/api/tasks/projects'), headers: _headers)
          .timeout(const Duration(seconds: 20)),
    );
    final projects = data['projects'];
    if (projects is! List) return const [];
    return projects.map((e) => e.toString()).toList();
  }

  /// Creates a work task. `config` mirrors WorkTask.config: prompt plus
  /// optional per-task model/agent overrides.
  Future<PiTask> createTask({
    required String projectRoot,
    required String title,
    String? prompt,
    String? modelId,
  }) async {
    final data = await post('/api/tasks', {
      'projectRoot': projectRoot,
      'title': title,
      'config': {
        'prompt': prompt ?? '',
        if (modelId != null && modelId.isNotEmpty) 'modelId': modelId,
      },
    });
    final task = data['task'];
    if (task is Map) {
      return PiTask.fromJson(Map<String, dynamic>.from(task));
    }
    throw PiApiException(_tr('服务器未返回任务数据'));
  }

  /// start | cancel | retry | requeue
  Future<void> taskAction(
    int id,
    String projectRoot,
    String action, {
    String? note,
  }) async {
    await post(
      '/api/tasks/$id/$action',
      {'note': ?note},
      query: {'projectRoot': projectRoot},
    );
  }

  /// Deletes a work task (optionally its worktree too).
  Future<void> deleteTask(
    int id,
    String projectRoot, {
    bool deleteWorktree = false,
  }) async {
    final response = await _client.delete(
      _uri('/api/tasks/$id', {
        'projectRoot': projectRoot,
        'deleteWorktree': deleteWorktree ? '1' : '0',
      }),
      headers: _headers,
    ).timeout(const Duration(seconds: 20));
    await _decode(response);
  }

  /// Session stats for the context ring / token display. Returns the raw
  /// `get_session_stats` response (may include contextUsage/tokens fields).
  Future<Map<String, dynamic>> getSessionStats(String sessionId) async {
    final data = await sendAgentCommand(sessionId, {
      'type': 'get_session_stats',
    });
    return data is Map ? Map<String, dynamic>.from(data) : const {};
  }

  void close() => _client.close();
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
