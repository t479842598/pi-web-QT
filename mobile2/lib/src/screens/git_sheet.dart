import 'package:flutter/material.dart';

import '../apple_theme.dart';
import '../chat_controller.dart';
import '../localization.dart';
import '../models.dart';

/// Bottom sheet showing the working-tree Git status for the current project
/// with per-file diff preview (read-only).
Future<void> showGitSheet(
  BuildContext context, {
  required ChatController controller,
}) async {
  final cwd = controller.draftCwd;
  if (cwd == null || cwd.isEmpty) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(context.tr('请先选择工作目录'))));
    return;
  }
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (context) => Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 680),
        child: FractionallySizedBox(
          heightFactor: .85,
          child: _GitSheet(controller: controller, cwd: cwd),
        ),
      ),
    ),
  );
}

class _GitSheet extends StatefulWidget {
  const _GitSheet({required this.controller, required this.cwd});
  final ChatController controller;
  final String cwd;

  @override
  State<_GitSheet> createState() => _GitSheetState();
}

class _GitSheetState extends State<_GitSheet> {
  GitStatus? _status;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final status = await widget.controller.api.getGitStatus(widget.cwd);
      if (!mounted) return;
      setState(() => _status = status);
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

  Future<void> _showDiff(GitFileStatus file) async {
    try {
      final diff = await widget.controller.api.getGitFileDiff(
        widget.cwd,
        file.filePath,
      );
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(
            file.fileName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          content: SingleChildScrollView(
            child: SelectableText(
              diff,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
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
    } catch (cause) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              cause.toString().replaceFirst('PiApiException: ', ''),
            ),
          ),
        );
      }
    }
  }

  String _statusLabel(GitFileStatus file) => switch (file.status) {
    'untracked' => context.tr('未跟踪'),
    'modified' => context.tr('已修改'),
    'staged' => context.tr('已暂存'),
    'deleted' => context.tr('已删除'),
    'renamed' => context.tr('已重命名'),
    _ => file.status,
  };

  Color? _statusColor(GitFileStatus file) => switch (file.status) {
    'untracked' => Colors.orange,
    'modified' => Theme.of(context).colorScheme.primary,
    'staged' => Colors.green,
    'deleted' => Theme.of(context).colorScheme.error,
    _ => null,
  };

  @override
  Widget build(BuildContext context) {
    final status = _status;
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
                  Icons.commit_rounded,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    context.tr('Git 变更'),
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (!_loading && status != null && status.isGitRepository)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Text(
                      context.tr('+{additions} / -{deletions}', {
                        'additions': status.additions,
                        'deletions': status.deletions,
                      }),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        fontWeight: FontWeight.w600,
                      ),
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
          const Divider(height: 1),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                ? _errorView(context)
                : status == null || !status.isGitRepository
                ? _noRepositoryView(context)
                : status.files.isEmpty
                ? Center(
                    child: Text(
                      context.tr('工作区没有变更'),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    itemCount: status.files.length,
                    separatorBuilder: (_, _) =>
                        const Divider(height: 1, indent: 56, endIndent: 12),
                    itemBuilder: (context, index) {
                      final file = status.files[index];
                      return ListTile(
                        leading: Icon(
                          Icons.insert_drive_file_outlined,
                          color: _statusColor(file),
                        ),
                        title: Text(
                          file.fileName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(
                          file.filePath,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: _statusColor(
                                  file,
                                )?.withValues(alpha: .12),
                                borderRadius: BorderRadius.circular(99),
                              ),
                              child: Text(
                                _statusLabel(file),
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: _statusColor(file),
                                ),
                              ),
                            ),
                            IconButton(
                              tooltip: context.tr('查看变更'),
                              onPressed: () => _showDiff(file),
                              icon: const Icon(Icons.chevron_right, size: 20),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _errorView(BuildContext context) => Center(
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
            onPressed: _load,
            icon: const Icon(Icons.refresh),
            label: Text(context.tr('重试')),
          ),
        ],
      ),
    ),
  );

  Widget _noRepositoryView(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.storage_outlined,
            size: 36,
            color: Theme.of(context).colorScheme.outline,
          ),
          const SizedBox(height: 10),
          Text(
            context.tr('当前目录不是 Git 仓库'),
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    ),
  );
}
