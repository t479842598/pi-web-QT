import 'dart:convert';

import 'package:flutter/material.dart';

import '../apple_theme.dart';
import '../chat_controller.dart';
import '../localization.dart';

/// MCP 服务器管理：列出 mcp.json 中的服务器，支持添加 / 编辑 / 删除。
/// 数据来自网页端同款接口（/api/mcp：GET 列表 / PUT 全量替换 / restart）。
Future<void> showMcpSheet(
  BuildContext context, {
  required ChatController controller,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    backgroundColor: Colors.transparent,
    builder: (context) => Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 680),
        child: FractionallySizedBox(
          heightFactor: .85,
          child: McpSheet(controller: controller),
        ),
      ),
    ),
  );
}

class McpSheet extends StatefulWidget {
  const McpSheet({super.key, required this.controller});

  final ChatController controller;

  @override
  State<McpSheet> createState() => _McpSheetState();
}

class _McpSheetState extends State<McpSheet> {
  Map<String, dynamic> _servers = const {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.controller.api.getMcpServers();
      if (!mounted) return;
      setState(() {
        final map = data['mcpServers'];
        _servers = map is Map
            ? Map<String, dynamic>.from(map)
            : <String, dynamic>{};
      });
    } catch (cause) {
      if (mounted) {
        setState(
          () => _error = cause
              .toString()
              .replaceFirst('PiApiException: ', '')
              .replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _saveAll(Map<String, dynamic> next) async {
    setState(() => _servers = next);
    try {
      await widget.controller.api.putMcpServers(next);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('MCP 配置已保存'))),
        );
      }
    } catch (cause) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              cause.toString().replaceFirst('PiApiException: ', ''),
            ),
          ),
        );
        _refresh();
      }
    }
  }

  Future<void> _edit([String? existingName]) async {
    final isEdit = existingName != null;
    final current = isEdit
        ? Map<String, dynamic>.from(_servers[existingName] as Map? ?? const {})
        : <String, dynamic>{};
    final nameController = TextEditingController(
      text: existingName ?? '',
    );
    final commandController = TextEditingController(
      text: current['command']?.toString() ?? '',
    );
    final argsController = TextEditingController(
      text: (current['args'] as List? ?? const []).join('\n'),
    );
    final transportController = TextEditingController(
      text: current['transport']?.toString() ?? 'stdio',
    );
    final envController = TextEditingController(
      text: current['env'] is Map
          ? const JsonEncoder.withIndent('  ').convert(current['env'])
          : '',
    );

    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(context.tr(isEdit ? '编辑 MCP 服务器' : '添加 MCP 服务器')),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: InputDecoration(
                  labelText: context.tr('名称'),
                  hintText: 'e.g. my-server',
                ),
              ),
              TextField(
                controller: commandController,
                decoration: InputDecoration(
                  labelText: context.tr('命令'),
                  hintText: 'npx / uvx / path',
                ),
              ),
              TextField(
                controller: argsController,
                decoration: InputDecoration(
                  labelText: context.tr('参数（每行一个）'),
                ),
                maxLines: 2,
              ),
              TextField(
                controller: transportController,
                decoration: InputDecoration(
                  labelText: context.tr('传输方式'),
                  hintText: 'stdio / sse / http',
                ),
              ),
              TextField(
                controller: envController,
                decoration: InputDecoration(
                  labelText: context.tr('环境变量（JSON）'),
                ),
                maxLines: 3,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(dialogContext.tr('取消')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(dialogContext.tr('保存')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    final name = nameController.text.trim();
    final command = commandController.text.trim();
    if (name.isEmpty || command.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('名称和命令不能为空'))),
        );
      }
      return;
    }
    final args = argsController.text
        .split('\n')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
    Map<String, dynamic>? env;
    final envText = envController.text.trim();
    if (envText.isNotEmpty) {
      try {
        final decoded = jsonDecode(envText);
        if (decoded is Map) {
          env = Map<String, dynamic>.from(decoded);
        }
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(context.tr('环境变量必须是合法 JSON'))),
          );
        }
        return;
      }
    }
    final transport = transportController.text.trim().isEmpty
        ? 'stdio'
        : transportController.text.trim();

    final next = Map<String, dynamic>.from(_servers);
    if (isEdit) next.remove(existingName);
    next[name] = <String, dynamic>{
      'command': command,
      if (args.isNotEmpty) 'args': args,
      'transport': transport,
      if (env != null) 'env': env,
    };
    await _saveAll(next);
  }

  Future<void> _remove(String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(context.tr('删除 MCP 服务器')),
        content: Text(
          context.tr('确定要删除 MCP 服务器“{name}”吗？', {'name': name}),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(dialogContext.tr('取消')),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(dialogContext.tr('删除')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final next = Map<String, dynamic>.from(_servers)..remove(name);
    await _saveAll(next);
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: const BorderRadius.vertical(
        top: Radius.circular(AppleRadius.panel),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 6, 12, 10),
            child: Row(
              children: [
                Icon(
                  Icons.terminal_outlined,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    context.tr('MCP 服务器'),
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: context.tr('重新加载'),
                  onPressed: _refresh,
                  icon: const Icon(Icons.refresh),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  tooltip: context.tr('关闭'),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.error_outline,
                            size: 36,
                            color: Theme.of(context).colorScheme.error,
                          ),
                          const SizedBox(height: 10),
                          Text(_error!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          OutlinedButton.icon(
                            onPressed: _refresh,
                            icon: const Icon(Icons.refresh),
                            label: Text(context.tr('重试')),
                          ),
                        ],
                      ),
                    ),
                  )
                : _servers.isEmpty
                ? Center(
                    child: Text(
                      context.tr('还没有 MCP 服务器'),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    itemCount: _servers.length,
                    separatorBuilder: (_, _) =>
                        const Divider(height: 1, indent: 56, endIndent: 12),
                    itemBuilder: (context, index) {
                      final name = _servers.keys.elementAt(index);
                      final value = _servers[name];
                      final command =
                          value is Map ? value['command']?.toString() ?? '' : '';
                      final transport = value is Map
                          ? value['transport']?.toString() ?? 'stdio'
                          : 'stdio';
                      return ListTile(
                        leading: const Icon(Icons.dns_outlined),
                        title: Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        subtitle: Text(
                          command.isEmpty ? transport : '$command · $transport',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              tooltip: context.tr('编辑'),
                              onPressed: () => _edit(name),
                              icon: const Icon(Icons.edit_outlined, size: 20),
                            ),
                            IconButton(
                              tooltip: context.tr('删除'),
                              onPressed: () => _remove(name),
                              icon: const Icon(Icons.delete_outline, size: 20),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: FilledButton.tonalIcon(
              onPressed: _edit,
              icon: const Icon(Icons.add, size: 18),
              label: Text(context.tr('添加 MCP 服务器')),
            ),
          ),
        ],
      ),
    );
  }
}
