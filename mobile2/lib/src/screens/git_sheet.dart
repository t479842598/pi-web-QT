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

class _GitSheetState extends State<_GitSheet>
    with SingleTickerProviderStateMixin {
  GitStatus? _status;
  bool _loading = true;
  String? _error;
  int _tab = 0;

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
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: TabBar(
              controller: TabController(
                length: 2,
                vsync: this,
                initialIndex: _tab,
              ),
              onTap: (index) => setState(() => _tab = index),
              indicatorSize: TabBarIndicatorSize.tab,
              labelStyle: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
              tabs: [
                Tab(text: context.tr('Git 变更')),
                Tab(text: context.tr('Worktree')),
              ],
            ),
          ),
          Expanded(
            child: _tab == 0 ? _changesView(context) : _WorktreePanel(
              controller: widget.controller,
              cwd: widget.cwd,
            ),
          ),
        ],
      ),
    );
  }

  Widget _changesView(BuildContext context) {
    final status = _status;
    return _loading
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
                        color: _statusColor(file)?.withValues(alpha: .12),
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

/// Worktree 面板：列出项目的 Git Worktree，支持创建 / 移除。
class _WorktreePanel extends StatefulWidget {
  const _WorktreePanel({required this.controller, required this.cwd});
  final ChatController controller;
  final String cwd;

  @override
  State<_WorktreePanel> createState() => _WorktreePanelState();
}

class _WorktreePanelState extends State<_WorktreePanel> {
  List<Map<String, dynamic>> _worktrees = const [];
  String? _projectRoot;
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
      final data = await widget.controller.api.getWorktrees(widget.cwd);
      if (!mounted) return;
      setState(() {
        _projectRoot = data['projectRoot']?.toString();
        final list = data['worktrees'];
        _worktrees = (list as List? ?? const [])
            .whereType<Map>()
            .map(Map<String, dynamic>.from)
            .toList();
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

  Future<void> _create() async {
    final branchController = TextEditingController();
    final branch = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(context.tr('创建 Worktree')),
        content: TextField(
          controller: branchController,
          autofocus: true,
          decoration: InputDecoration(
            hintText: context.tr('分支名（已存在则复用，否则新建）'),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(dialogContext.tr('取消')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, branchController.text.trim()),
            child: Text(dialogContext.tr('创建')),
          ),
        ],
      ),
    );
    branchController.dispose();
    if (branch == null || branch.isEmpty || !mounted) return;
    try {
      await widget.controller.api.createWorktree(widget.cwd, branch);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('Worktree 已创建'))),
        );
        _load();
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
      }
    }
  }

  Future<void> _remove(Map<String, dynamic> worktree) async {
    final path = worktree['path']?.toString() ?? '';
    final branch = worktree['branch']?.toString() ?? '';
    if (path.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(context.tr('移除 Worktree')),
        content: Text(
          context.tr('确定要移除这个 Worktree 吗？\n{branch} @ {path}', {
            'branch': branch,
            'path': path,
          }),
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
            child: Text(dialogContext.tr('移除')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await widget.controller.api.removeWorktree(widget.cwd, path);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('Worktree 已移除'))),
        );
        _load();
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
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 6),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  _projectRoot == null
                      ? context.tr('Git Worktree')
                      : _projectRoot!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
              FilledButton.tonalIcon(
                onPressed: _create,
                icon: const Icon(Icons.add, size: 18),
                label: Text(context.tr('创建')),
              ),
            ],
          ),
        ),
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
                          size: 32,
                          color: Theme.of(context).colorScheme.error,
                        ),
                        const SizedBox(height: 8),
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
                )
              : _worktrees.isEmpty
              ? Center(
                  child: Text(
                    context.tr('没有 Worktree，点击右上角创建'),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  itemCount: _worktrees.length,
                  separatorBuilder: (_, _) =>
                      const Divider(height: 1, indent: 16, endIndent: 16),
                  itemBuilder: (context, index) {
                    final worktree = _worktrees[index];
                    final path = worktree['path']?.toString() ?? '';
                    final branch = worktree['branch']?.toString() ?? '';
                    final isCurrent = worktree['isCurrent'] == true ||
                        path == _projectRoot;
                    return ListTile(
                      leading: Icon(
                        isCurrent ? Icons.check_circle : Icons.call_split,
                        color: isCurrent
                            ? Theme.of(context).colorScheme.primary
                            : Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                      title: Row(
                        children: [
                          Flexible(
                            child: Text(
                              branch,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          if (isCurrent) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: Theme.of(
                                  context,
                                ).colorScheme.primary.withValues(alpha: .12),
                                borderRadius: BorderRadius.circular(99),
                              ),
                              child: Text(
                                context.tr('当前'),
                                style: TextStyle(
                                  fontSize: 11,
                                  color: Theme.of(context).colorScheme.primary,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      subtitle: Text(
                        path,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: IconButton(
                        tooltip: context.tr('移除'),
                        onPressed: () => _remove(worktree),
                        icon: const Icon(Icons.delete_outline, size: 20),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
