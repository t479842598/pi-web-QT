import 'package:flutter/material.dart';

import '../apple_theme.dart';
import '../chat_controller.dart';
import '../localization.dart';
import '../models.dart';
import 'directory_picker.dart';

/// Bottom sheet for creating a work task: title, project, description and
/// model — mirrors MonkeyCode's new-task form (minus voice input).
Future<PiTask?> showNewTaskSheet(
  BuildContext context, {
  required ChatController controller,
}) {
  return showModalBottomSheet<PiTask>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => _NewTaskSheet(controller: controller),
  );
}

class _NewTaskSheet extends StatefulWidget {
  const _NewTaskSheet({required this.controller});

  final ChatController controller;

  @override
  State<_NewTaskSheet> createState() => _NewTaskSheetState();
}

class _NewTaskSheetState extends State<_NewTaskSheet> {
  final _titleController = TextEditingController();
  final _promptController = TextEditingController();
  String? _projectPath;
  PiModel? _model;
  bool _submitting = false;

  @override
  void dispose() {
    _titleController.dispose();
    _promptController.dispose();
    super.dispose();
  }

  ChatController get _controller => widget.controller;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              context.tr('新建任务'),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _titleController,
              maxLines: 1,
              decoration: InputDecoration(
                labelText: context.tr('任务标题'),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppleRadius.lg),
                ),
              ),
            ),
            const SizedBox(height: 12),
            // Project selector.
            InkWell(
              onTap: _pickProject,
              borderRadius: BorderRadius.circular(AppleRadius.lg),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 14,
                ),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainer,
                  borderRadius: BorderRadius.circular(AppleRadius.lg),
                ),
                child: Row(
                  children: [
                    Icon(Icons.folder_rounded, size: 18, color: scheme.primary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _projectPath ?? context.tr('选择项目目录'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: _projectPath == null
                              ? scheme.onSurfaceVariant
                              : scheme.onSurface,
                          fontFamily: _projectPath == null
                              ? null
                              : 'monospace',
                          fontSize: 13,
                        ),
                      ),
                    ),
                    Icon(Icons.chevron_right_rounded, color: scheme.outline),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _promptController,
              maxLines: 4,
              minLines: 3,
              decoration: InputDecoration(
                labelText: context.tr('任务描述'),
                alignLabelWithHint: true,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppleRadius.lg),
                ),
              ),
            ),
            const SizedBox(height: 12),
            // Model selector.
            InkWell(
              onTap: _pickModel,
              borderRadius: BorderRadius.circular(AppleRadius.lg),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 14,
                ),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainer,
                  borderRadius: BorderRadius.circular(AppleRadius.lg),
                ),
                child: Row(
                  children: [
                    Icon(Icons.memory_rounded, size: 18, color: scheme.primary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _model == null
                            ? context.tr('选择模型（可选）')
                            : _model!.id,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: _model == null
                              ? scheme.onSurfaceVariant
                              : scheme.onSurface,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    Icon(Icons.chevron_right_rounded, color: scheme.outline),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _submitting ? null : _submit,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(54),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppleRadius.lg),
                ),
              ),
              child: _submitting
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2.4),
                    )
                  : Text(
                      context.tr('创建任务'),
                      style: const TextStyle(fontSize: 16),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickProject() async {
    final controller = _controller;
    final selected = await showDirectoryPicker(
      context,
      controller: controller,
    );
    if (selected != null && mounted) {
      setState(() => _projectPath = selected);
    }
  }

  Future<void> _pickModel() async {
    final controller = _controller;
    final models = controller.models;
    if (models.isEmpty) {
      await controller.loadModels(controller.draftCwd ?? controller.sessions
          .where((s) => s.id == controller.activeSessionId)
          .firstOrNull
          ?.cwd ?? '');
      if (!mounted) return;
    }
    final selected = await showModalBottomSheet<PiModel>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                context.tr('选择模型'),
                style: Theme.of(sheetContext).textTheme.titleLarge,
              ),
            ),
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: models.length,
                itemBuilder: (_, index) {
                  final model = models[index];
                  return ListTile(
                    leading: const Icon(Icons.memory_rounded),
                    title: Text(model.id),
                    subtitle: Text('${model.provider} · ${model.id}'),
                    trailing: _model?.id == model.id
                        ? Icon(
                            Icons.check_circle_rounded,
                            color: Theme.of(sheetContext).colorScheme.primary,
                          )
                        : null,
                    onTap: () => Navigator.pop(sheetContext, model),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
    if (selected != null && mounted) {
      setState(() => _model = selected);
    }
  }

  Future<void> _submit() async {
    final project = _projectPath;
    if (project == null) {
      _toast(context.tr('请先选择项目目录'));
      return;
    }
    final title = _titleController.text.trim();
    if (title.isEmpty) {
      _toast(context.tr('请输入任务标题'));
      return;
    }
    setState(() => _submitting = true);
    try {
      await _controller.createTask(
        projectRoot: project,
        title: title,
        prompt: _promptController.text.trim(),
        modelId: _model?.id,
      );
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        setState(() => _submitting = false);
        _toast('${context.tr('创建失败')}: $e');
      }
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }
}
