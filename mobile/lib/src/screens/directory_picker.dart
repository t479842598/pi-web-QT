import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../apple_theme.dart';
import '../chat_controller.dart';
import '../localization.dart';
import '../models.dart';
import '../pi_api.dart';

Future<String?> showDirectoryPicker(
  BuildContext context, {
  required ChatController controller,
  String? initialPath,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (context) =>
        _DirectoryPickerSheet(controller: controller, initialPath: initialPath),
  );
}

class _DirectoryPickerSheet extends StatefulWidget {
  const _DirectoryPickerSheet({required this.controller, this.initialPath});
  final ChatController controller;
  final String? initialPath;

  @override
  State<_DirectoryPickerSheet> createState() => _DirectoryPickerSheetState();
}

class _DirectoryPickerSheetState extends State<_DirectoryPickerSheet> {
  late final TextEditingController _pathController;
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();
  DirectoryListing? _listing;
  bool _loading = false;
  bool _creating = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _pathController = TextEditingController(text: widget.initialPath ?? '');
    _navigate(widget.initialPath);
  }

  @override
  void dispose() {
    _pathController.dispose();
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _navigate([String? path]) async {
    if (_loading) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final listing = await widget.controller.browseDirectories(path);
      if (!mounted) return;
      setState(() {
        _listing = listing;
        _pathController.text = listing.path;
        _searchController.clear();
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _scrollController.hasClients) {
          _scrollController.jumpTo(0);
        }
      });
    } catch (cause) {
      if (mounted) {
        setState(
          () => _error = cause
              .toString()
              .replaceFirst('Exception: ', '')
              .replaceFirst('PiApiException: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<DirectoryEntry> get _filteredEntries {
    final keyword = _searchController.text.trim().toLowerCase();
    final entries = _listing?.directories ?? const <DirectoryEntry>[];
    if (keyword.isEmpty) return entries;
    return entries
        .where(
          (entry) =>
              entry.name.toLowerCase().contains(keyword) ||
              entry.path.toLowerCase().contains(keyword),
        )
        .toList();
  }

  Future<void> _createDirectory() async {
    final parentPath = _listing?.path;
    if (parentPath == null || parentPath.isEmpty || _loading || _creating) {
      return;
    }
    final name = await showDialog<String>(
      context: context,
      builder: (context) => _CreateDirectoryDialog(parentPath: parentPath),
    );
    if (!mounted || name == null || name.isEmpty) return;

    setState(() => _creating = true);
    try {
      final createdPath = await widget.controller.createDirectory(
        parentPath,
        name,
      );
      if (mounted) await _navigate(createdPath);
    } catch (cause) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_createErrorText(cause))));
      }
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  String _createErrorText(Object cause) {
    final text = cause.toString();
    if (text.contains('Directory already exists')) {
      return context.tr('同名文件夹已经存在');
    }
    if (text.contains('No permission')) {
      return context.tr('当前目录没有创建文件夹的权限');
    }
    if (text.contains('outside the allowed workspace')) {
      return context.tr('只能在已授权的工作目录中创建文件夹');
    }
    if (cause is PiApiException && cause.statusCode == 405) {
      return context.tr('当前服务端暂不支持创建文件夹，请到 Pi Web 桌面端创建后再刷新');
    }
    return context.tr('创建文件夹失败：{error}', {
      'error': text.replaceFirst('PiApiException: ', ''),
    });
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final availableHeight = media.size.height - media.viewInsets.bottom;
    final height = math.min(availableHeight * .9, 720.0);
    final listing = _listing;
    return AnimatedPadding(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: Align(
        alignment: Alignment.bottomCenter,
        child: Container(
          width: double.infinity,
          height: height,
          constraints: const BoxConstraints(maxWidth: 680),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(AppleRadius.panel),
            ),
            boxShadow: AppleShadows.floating,
          ),
          child: Column(
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
              _header(context),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (widget.controller.knownCwds.isNotEmpty)
                        _recentDirectories(context),
                      _pathBar(listing),
                      const SizedBox(height: 10),
                      _searchField(),
                      const SizedBox(height: 10),
                      Expanded(child: _directoryList(context)),
                    ],
                  ),
                ),
              ),
              _bottomBar(context, listing),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 10, 8, 8),
    child: Row(
      children: [
        Icon(
          Icons.folder_open_rounded,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            context.tr('选择工作目录'),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
        IconButton(
          key: const Key('create-directory-button'),
          onPressed: _loading || _creating || _listing?.path.isNotEmpty != true
              ? null
              : _createDirectory,
          tooltip: context.tr('新建文件夹'),
          icon: _creating
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.create_new_folder_outlined),
        ),
        IconButton(
          onPressed: () => Navigator.pop(context),
          tooltip: context.tr('关闭'),
          icon: const Icon(Icons.close),
        ),
      ],
    ),
  );

  Widget _recentDirectories(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: widget.controller.knownCwds.length,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (context, index) {
          final cwd = widget.controller.knownCwds[index];
          return Tooltip(
            message: cwd,
            child: ActionChip(
              visualDensity: VisualDensity.compact,
              avatar: const Icon(Icons.history, size: 16),
              label: Text(_leafName(cwd)),
              onPressed: () => _navigate(cwd),
            ),
          );
        },
      ),
    ),
  );

  Widget _pathBar(DirectoryListing? listing) => Row(
    children: [
      IconButton.outlined(
        onPressed: !_loading && listing?.parentPath != null
            ? () => _navigate(listing!.parentPath)
            : null,
        tooltip: context.tr('上一级目录'),
        icon: const Icon(Icons.arrow_upward_rounded),
      ),
      const SizedBox(width: 8),
      Expanded(
        child: TextField(
          controller: _pathController,
          autocorrect: false,
          textInputAction: TextInputAction.go,
          onSubmitted: _navigate,
          decoration: InputDecoration(
            hintText: context.tr('输入完整目录路径'),
            isDense: true,
          ),
        ),
      ),
      const SizedBox(width: 8),
      IconButton.filledTonal(
        onPressed: _loading ? null : () => _navigate(_pathController.text),
        tooltip: context.tr('打开路径'),
        icon: const Icon(Icons.arrow_forward_rounded),
      ),
    ],
  );

  Widget _searchField() => TextField(
    controller: _searchController,
    enabled: !_loading,
    onChanged: (_) => setState(() {}),
    decoration: InputDecoration(
      prefixIcon: const Icon(Icons.search),
      hintText: context.tr('筛选当前目录'),
      isDense: true,
      suffixIcon: _searchController.text.isEmpty
          ? null
          : IconButton(
              tooltip: context.tr('清除'),
              onPressed: () {
                _searchController.clear();
                setState(() {});
              },
              icon: const Icon(Icons.clear),
            ),
    ),
  );

  Widget _directoryList(BuildContext context) {
    final entries = _filteredEntries;
    return Material(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(AppleRadius.panel),
      clipBehavior: Clip.antiAlias,
      child: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? _errorView(context)
          : entries.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  context.tr(
                    _searchController.text.isEmpty ? '当前目录没有子目录' : '没有匹配的目录',
                  ),
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            )
          : Scrollbar(
              controller: _scrollController,
              thumbVisibility: true,
              interactive: true,
              child: ListView.separated(
                controller: _scrollController,
                padding: const EdgeInsets.symmetric(vertical: 6),
                itemCount: entries.length,
                separatorBuilder: (_, _) =>
                    const Divider(height: 1, indent: 54, endIndent: 12),
                itemBuilder: (context, index) {
                  final entry = entries[index];
                  return ListTile(
                    leading: const Icon(Icons.folder_rounded),
                    title: Text(
                      entry.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      entry.path,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: IconButton(
                      tooltip: context.tr('选择此目录'),
                      onPressed: () => Navigator.pop(context, entry.path),
                      icon: const Icon(Icons.check_circle_outline),
                    ),
                    onTap: () => _navigate(entry.path),
                  );
                },
              ),
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
            Icons.folder_off_outlined,
            size: 36,
            color: Theme.of(context).colorScheme.error,
          ),
          const SizedBox(height: 10),
          Text(_error!, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => _navigate(_pathController.text),
            icon: const Icon(Icons.refresh),
            label: Text(context.tr('重新加载')),
          ),
        ],
      ),
    ),
  );

  Widget _bottomBar(
    BuildContext context,
    DirectoryListing? listing,
  ) => SafeArea(
    top: false,
    child: Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(top: BorderSide(color: Theme.of(context).dividerColor)),
      ),
      child: FilledButton.icon(
        onPressed: !_loading && listing?.path.isNotEmpty == true
            ? () => Navigator.pop(context, listing!.path)
            : null,
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        icon: const Icon(Icons.check),
        label: Text(
          listing?.path.isNotEmpty == true
              ? context.tr('选择 {name}', {'name': _leafName(listing!.path)})
              : context.tr('选择当前目录'),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    ),
  );

  String _leafName(String path) {
    final parts = path.split(RegExp(r'[/\\]')).where((part) => part.isNotEmpty);
    return parts.isEmpty ? path : parts.last;
  }
}

class _CreateDirectoryDialog extends StatefulWidget {
  const _CreateDirectoryDialog({required this.parentPath});

  final String parentPath;

  @override
  State<_CreateDirectoryDialog> createState() => _CreateDirectoryDialogState();
}

class _CreateDirectoryDialogState extends State<_CreateDirectoryDialog> {
  final _nameController = TextEditingController();
  bool _canCreate = false;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _nameController.text.trim();
    // Reject path separators and traversal components up front; the server
    // would reject them with a confusing raw error otherwise.
    if (name.isNotEmpty &&
        !name.contains('/') &&
        !name.contains('\\') &&
        name != '.' &&
        name != '..') {
      Navigator.pop(context, name);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    icon: const Icon(Icons.create_new_folder_outlined),
    title: Text(context.tr('新建文件夹')),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          context.tr('将在 {path} 中创建', {'path': widget.parentPath}),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 14),
        TextField(
          key: const Key('new-directory-name'),
          controller: _nameController,
          autofocus: true,
          maxLength: 128,
          textInputAction: TextInputAction.done,
          decoration: InputDecoration(labelText: context.tr('文件夹名称')),
          onChanged: (value) =>
              setState(() => _canCreate = value.trim().isNotEmpty),
          onSubmitted: (_) => _submit(),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(context.tr('取消')),
      ),
      FilledButton(
        key: const Key('create-directory-confirm'),
        onPressed: _canCreate ? _submit : null,
        child: Text(context.tr('创建并进入')),
      ),
    ],
  );
}
