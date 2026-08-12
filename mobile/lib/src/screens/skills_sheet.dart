import 'package:flutter/material.dart';

import '../apple_theme.dart';
import '../chat_controller.dart';
import '../models.dart';
import '../localization.dart';

Future<void> showSkillsSheet(
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
          heightFactor: .9,
          child: _SkillsSheet(controller: controller, cwd: cwd),
        ),
      ),
    ),
  );
}

class _SkillsSheet extends StatefulWidget {
  const _SkillsSheet({required this.controller, required this.cwd});

  final ChatController controller;
  final String cwd;

  @override
  State<_SkillsSheet> createState() => _SkillsSheetState();
}

class _SkillsSheetState extends State<_SkillsSheet> {
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();
  final _expandedDormantGroups = <String>{};
  String _query = '';

  ChatController get controller => widget.controller;

  @override
  void initState() {
    super.initState();
    if (controller.skills.isEmpty && !controller.loadingSkills) {
      controller.loadSkills(widget.cwd);
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final query = _query.trim().toLowerCase();
        final visibleSkills = controller.skills.where((skill) {
          if (query.isEmpty) return true;
          return skill.name.toLowerCase().contains(query) ||
              skill.description.toLowerCase().contains(query) ||
              skill.filePath.toLowerCase().contains(query);
        }).toList();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 12, 12),
              child: Row(
                children: [
                  const Icon(Icons.auto_awesome_outlined),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          context.tr('技能 · {count}', {
                            'count': controller.skills.length,
                          }),
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                        Text(
                          widget.cwd,
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
                    onPressed: controller.loadingSkills
                        ? null
                        : () => controller.loadSkills(widget.cwd),
                    tooltip: context.tr('刷新技能'),
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
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: TextField(
                controller: _searchController,
                onChanged: (value) => setState(() => _query = value),
                decoration: InputDecoration(
                  hintText: context.tr('搜索技能名称、说明或路径'),
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _query = '');
                          },
                          icon: const Icon(Icons.clear),
                        ),
                ),
              ),
            ),
            if (!controller.projectSkillResourcesLoaded)
              _SkillNotice(
                icon: Icons.lock_outline,
                text: context.tr('当前项目资源未加载，项目级技能可能不在列表中。'),
              ),
            if (controller.skillDiagnostics.isNotEmpty)
              _SkillNotice(
                icon: Icons.warning_amber_rounded,
                text: context.tr('加载时发现 {count} 条诊断信息', {
                  'count': controller.skillDiagnostics.length,
                }),
              ),
            Expanded(child: _content(visibleSkills)),
          ],
        );
      },
    );
  }

  Widget _content(List<PiSkill> skills) {
    if (controller.loadingSkills && controller.skills.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (controller.skillsError != null && controller.skills.isEmpty) {
      return _SkillEmptyState(
        icon: Icons.error_outline,
        title: context.tr('技能加载失败'),
        message: controller.skillsError!,
        onRetry: () => controller.loadSkills(widget.cwd),
      );
    }
    if (skills.isEmpty) {
      return _SkillEmptyState(
        icon: _query.isEmpty ? Icons.auto_awesome_outlined : Icons.search_off,
        title: context.tr(_query.isEmpty ? '当前目录没有加载技能' : '没有找到匹配技能'),
        message: context.tr(
          _query.isEmpty ? '可以先在 Pi Web 中安装或配置技能。' : '请换一个关键字再试。',
        ),
      );
    }
    final grouped = <String, List<PiSkill>>{};
    for (final skill in skills) {
      grouped
          .putIfAbsent(skill.sourceLabelFor(context.appLanguage), () => [])
          .add(skill);
    }
    final sourceOrder = [context.tr('项目'), context.tr('全局'), context.tr('路径')];
    final groupNames = grouped.keys.toList()
      ..sort((a, b) {
        final aIndex = sourceOrder.indexOf(a);
        final bIndex = sourceOrder.indexOf(b);
        return (aIndex < 0 ? sourceOrder.length : aIndex).compareTo(
          bIndex < 0 ? sourceOrder.length : bIndex,
        );
      });
    final searching = _query.trim().isNotEmpty;
    final rows = <Widget>[];
    for (final groupName in groupNames) {
      final groupSkills = grouped[groupName]!;
      final active = groupSkills
          .where((skill) => !skill.disableModelInvocation)
          .toList();
      final dormant = groupSkills
          .where((skill) => skill.disableModelInvocation)
          .toList();
      rows.add(
        _SkillGroupLabel(
          label: groupName,
          activeCount: active.length,
          totalCount: groupSkills.length,
        ),
      );
      for (final skill in active) {
        rows.add(_SkillRow(skill: skill));
        rows.add(const Divider(indent: 48));
      }
      if (dormant.isNotEmpty) {
        final dormantOpen =
            searching || _expandedDormantGroups.contains(groupName);
        rows.add(
          _DormantSkillsHeader(
            count: dormant.length,
            expanded: dormantOpen,
            onTap: () => setState(() {
              if (dormantOpen && !searching) {
                _expandedDormantGroups.remove(groupName);
              } else {
                _expandedDormantGroups.add(groupName);
              }
            }),
          ),
        );
        if (dormantOpen) {
          for (final skill in dormant) {
            rows.add(const Divider(indent: 48));
            rows.add(_SkillRow(skill: skill));
          }
        }
      }
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 18, 20),
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
            child: ListView(
              controller: _scrollController,
              padding: EdgeInsets.zero,
              children: rows,
            ),
          ),
        ),
      ),
    );
  }
}

class _SkillGroupLabel extends StatelessWidget {
  const _SkillGroupLabel({
    required this.label,
    required this.activeCount,
    required this.totalCount,
  });

  final String label;
  final int activeCount;
  final int totalCount;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 14, 16, 7),
    child: Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
              letterSpacing: .5,
            ),
          ),
        ),
        Text(
          context.tr('{active} 个开启 · {total} 个技能', {
            'active': activeCount,
            'total': totalCount,
          }),
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: Theme.of(context).colorScheme.outline,
          ),
        ),
      ],
    ),
  );
}

class _DormantSkillsHeader extends StatelessWidget {
  const _DormantSkillsHeader({
    required this.count,
    required this.expanded,
    required this.onTap,
  });

  final int count;
  final bool expanded;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: SizedBox(
      height: 48,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: [
            AnimatedRotation(
              turns: expanded ? .25 : 0,
              duration: MediaQuery.disableAnimationsOf(context)
                  ? Duration.zero
                  : const Duration(milliseconds: 220),
              curve: Curves.easeOutQuart,
              child: Icon(
                Icons.chevron_right,
                size: 19,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(width: 7),
            Text(
              context.tr('休眠 · {count}', {'count': count}),
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
            ),
            const Spacer(),
            Text(
              context.tr(expanded ? '收起' : '展开查看'),
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: Theme.of(context).colorScheme.outline,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _SkillRow extends StatelessWidget {
  const _SkillRow({required this.skill});

  final PiSkill skill;

  @override
  Widget build(BuildContext context) {
    final enabled = !skill.disableModelInvocation;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 15, 16, 15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                enabled ? Icons.auto_awesome : Icons.visibility_off_outlined,
                size: 20,
                color: enabled
                    ? Theme.of(context).colorScheme.primary
                    : Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  skill.name,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              _SkillBadge(text: skill.sourceLabelFor(context.appLanguage)),
              const SizedBox(width: 6),
              _SkillBadge(
                text: context.tr(enabled ? '可调用' : '已隐藏'),
                active: enabled,
              ),
            ],
          ),
          if (skill.description.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              skill.description,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                height: 1.4,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
          if (skill.filePath.isNotEmpty) ...[
            const SizedBox(height: 9),
            Text(
              skill.filePath,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                color: Theme.of(context).colorScheme.outline,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SkillBadge extends StatelessWidget {
  const _SkillBadge({required this.text, this.active = false});

  final String text;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: active
            ? colors.primary.withValues(alpha: .08)
            : colors.onSurface.withValues(alpha: .05),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: active ? colors.primary : colors.onSurfaceVariant,
        ),
      ),
    );
  }
}

class _SkillNotice extends StatelessWidget {
  const _SkillNotice({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
    child: Row(
      children: [
        Icon(icon, size: 18),
        const SizedBox(width: 8),
        Expanded(child: Text(text)),
      ],
    ),
  );
}

class _SkillEmptyState extends StatelessWidget {
  const _SkillEmptyState({
    required this.icon,
    required this.title,
    required this.message,
    this.onRetry,
  });

  final IconData icon;
  final String title;
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Column(
        children: [
          Icon(icon, size: 44, color: Theme.of(context).colorScheme.outline),
          const SizedBox(height: 14),
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(message, textAlign: TextAlign.center),
          if (onRetry != null) ...[
            const SizedBox(height: 16),
            FilledButton.tonal(
              onPressed: onRetry,
              child: Text(context.tr('重试')),
            ),
          ],
        ],
      ),
    ),
  );
}
