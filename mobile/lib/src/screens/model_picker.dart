import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../apple_theme.dart';
import '../chat_controller.dart';
import '../localization.dart';
import '../models.dart';

Future<void> showModelPicker(
  BuildContext context, {
  required ChatController controller,
}) async {
  final selected = await showModalBottomSheet<PiModel>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ModelPickerSheet(controller: controller),
  );
  if (selected != null) await controller.selectModel(selected);
}

class _ModelPickerSheet extends StatefulWidget {
  const _ModelPickerSheet({required this.controller});
  final ChatController controller;

  @override
  State<_ModelPickerSheet> createState() => _ModelPickerSheetState();
}

class _ModelPickerSheetState extends State<_ModelPickerSheet> {
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final availableHeight = media.size.height - media.viewInsets.bottom;
    final height = math.min(availableHeight * .88, 720.0);
    final keyword = _searchController.text.trim().toLowerCase();
    final models = widget.controller.models
        .where(
          (model) =>
              keyword.isEmpty ||
              model.name.toLowerCase().contains(keyword) ||
              model.id.toLowerCase().contains(keyword) ||
              model.provider.toLowerCase().contains(keyword),
        )
        .toList();
    final selectedModel = widget.controller.selectedModel;
    return AnimatedPadding(
      duration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 220),
      curve: Curves.easeOutQuart,
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
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 38,
                height: 5,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 8, 8),
                child: Row(
                  children: [
                    Icon(
                      Icons.memory_outlined,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            context.tr('选择模型'),
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          Text(
                            selectedModel == null
                                ? context.tr('尚未选择模型')
                                : context.tr('当前：{name} · {provider}', {
                                    'name': selectedModel.name,
                                    'provider': selectedModel.provider,
                                  }),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
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
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: TextField(
                  controller: _searchController,
                  autofocus: true,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.search),
                    hintText: context.tr('搜索模型名称、提供商或 ID'),
                    isDense: true,
                    suffixIcon: keyword.isEmpty
                        ? null
                        : IconButton(
                            onPressed: () {
                              _searchController.clear();
                              setState(() {});
                            },
                            tooltip: context.tr('清除'),
                            icon: const Icon(Icons.clear),
                          ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 0, 18, 8),
                child: Row(
                  children: [
                    Text(
                      context.tr('{count} 个可用模型', {'count': models.length}),
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const Spacer(),
                    if (keyword.isNotEmpty)
                      Text(
                        context.tr('筛选结果'),
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: Theme.of(context).colorScheme.outline,
                        ),
                      ),
                  ],
                ),
              ),
              Expanded(child: _modelList(context, models)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _modelList(BuildContext context, List<PiModel> models) {
    if (widget.controller.loadingModels) {
      return const Center(child: CircularProgressIndicator());
    }
    if (models.isEmpty) {
      return Center(
        child: Text(
          context.tr('没有找到匹配模型'),
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 18, 18),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppleRadius.panel),
          boxShadow: AppleShadows.panel,
        ),
        child: Material(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(AppleRadius.panel),
          clipBehavior: Clip.antiAlias,
          child: Scrollbar(
            controller: _scrollController,
            thumbVisibility: true,
            interactive: true,
            child: ListView.separated(
              controller: _scrollController,
              padding: EdgeInsets.zero,
              itemCount: models.length,
              separatorBuilder: (_, _) => const Divider(indent: 54),
              itemBuilder: (context, index) {
                final model = models[index];
                final selected = model == widget.controller.selectedModel;
                return ListTile(
                  selected: selected,
                  leading: Icon(
                    Icons.memory_outlined,
                    size: 21,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                  title: Text(model.name),
                  subtitle: Text('${model.provider} / ${model.id}'),
                  trailing: selected
                      ? Icon(
                          Icons.check_circle,
                          color: Theme.of(context).colorScheme.primary,
                        )
                      : const Icon(Icons.chevron_right, size: 20),
                  onTap: () => Navigator.pop(context, model),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}
