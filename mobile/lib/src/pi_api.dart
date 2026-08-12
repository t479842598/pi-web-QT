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
    final parsedMessages = (messages as List? ?? const [])
        .whereType<Map>()
        .map(
          (value) => ChatMessage.fromJson(
            Map<String, dynamic>.from(value),
            language: language,
          ),
        )
        .toList();
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
  }) async {
    final response = await _client
        .post(
          _uri(path),
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
  }) async {
    await post('/api/agent/${Uri.encodeComponent(sessionId)}', {
      'type': 'prompt',
      'message': message,
      if (images.isNotEmpty)
        'images': images.map((image) => image.toJson()).toList(),
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

  void close() => _client.close();
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
