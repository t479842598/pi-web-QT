import 'package:flutter/material.dart';

import '../apple_theme.dart';
import '../chat_controller.dart';
import '../localization.dart';
import '../models.dart';
import '../widgets/swipeable_row.dart';
import '../widgets/task_card.dart';

/// MonkeyCode-style root "Tasks" screen: segmented 进行中/已结束 filter,
/// task cards with left-swipe actions, pull-to-refresh and a create-task
/// sheet (FAB is owned by the GlassDock shell).
class TasksScreen extends StatefulWidget {
  const TasksScreen({
    super.key,
    required this.controller,
    this.onCreateTask,
  });

  final ChatController controller;

  /// Optional hook to open a task's conversation in the full chat screen.
  final void Function(PiTask task)? onCreateTask;

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen>
    with AutomaticKeepAliveClientMixin {
  bool _finished = false;
  final Map<int, String> _tokensCache = {};

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    widget.controller.stopTasksPolling();
    super.dispose();
  }

  Future<void> _refresh() async {
    await widget.controller.refreshTasks();
    if (mounted) _loadTokens();
  }

  Future<void> _loadTokens() async {
    for (final task in widget.controller.tasks) {
      if (_tokensCache.containsKey(task.id)) continue;
      final stats = await widget.controller.fetchTaskTokens(task);
      if (!mounted) return;
      final tokens = _extractTokens(stats);
      if (tokens != null) {
        setState(() => _tokensCache[task.id] = tokens);
      }
    }
  }

  String? _extractTokens(Map<String, dynamic>? stats) {
    if (stats == null) return null;
    // get_session_stats returns a nested structure; try common shapes.
    final map = stats;
    final total = map['totalTokens'] ??
        map['tokens'] ??
        (map['stats'] is Map ? (map['stats'] as Map)['totalTokens'] : null);
    final n = total is num ? total.toInt() : null;
    if (n == null || n <= 0) return null;
    if (n >= 1000000) {
      return '${(n / 1000000).toStringAsFixed(1)}M tokens';
    }
    if (n >= 1000) {
      return '${(n / 1000).toStringAsFixed(1)}k tokens';
    }
    return '$n tokens';
  }

  List<PiTask> get _visibleTasks {
    final all = widget.controller.tasks;
    return _finished
        ? all.where((t) => t.status.isFinished).toList()
        : all.where((t) => t.status.isActive).toList();
  }

  Future<void> _confirmCancel(PiTask task) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(context.tr('终止任务？')),
        content: Text(context.tr('任务将停止运行，此操作不可撤销。')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(context.tr('取消')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(context.tr('终止')),
          ),
        ],
      ),
    );
    if (ok == true && mounted) {
      await widget.controller.cancelTask(task);
      _loadTokens();
    }
  }

  Future<void> _confirmDelete(PiTask task) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(context.tr('删除任务？')),
        content: Text(context.tr('任务记录将被永久删除。')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(context.tr('取消')),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(context.tr('删除')),
          ),
        ],
      ),
    );
    if (ok == true && mounted) {
      await widget.controller.deleteTask(task);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    widget.controller.startTasksPolling();
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: scheme.surfaceContainerLowest,
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverAppBar(
              pinned: true,
              floating: true,
              toolbarHeight: 76,
              elevation: 0,
              scrolledUnderElevation: 0,
              backgroundColor: Colors.transparent,
              surfaceTintColor: Colors.transparent,
              automaticallyImplyLeading: false,
              flexibleSpace: FlexibleSpaceBar(
                titlePadding: EdgeInsets.fromLTRB(
                  20,
                  MediaQuery.paddingOf(context).top + 10,
                  20,
                  12,
                ),
                title: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    context.tr('任务'),
                    style: TextStyle(
                      fontSize: 31,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.9,
                      color: scheme.onSurface,
                    ),
                  ),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
                child: _SegmentedTabs(
                  finished: _finished,
                  onChange: (finished) => setState(() => _finished = finished),
                ),
              ),
            ),
            if (_visibleTasks.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: _EmptyState(finished: _finished),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 120),
                sliver: SliverList.separated(
                  itemCount: _visibleTasks.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final task = _visibleTasks[index];
                    final actions = <Widget>[
                      if (task.status.isActive)
                        SwipeActionButton(
                          icon: Icons.stop_rounded,
                          label: context.tr('终止'),
                          color: const Color(0xffd29922),
                          onTap: () => _confirmCancel(task),
                        )
                      else
                        SwipeActionButton(
                          icon: Icons.delete_outline_rounded,
                          label: context.tr('删除'),
                          color: Theme.of(context).colorScheme.error,
                          onTap: () => _confirmDelete(task),
                        ),
                    ];
                    return SwipeableRow(
                      actions: actions,
                      child: TaskCard(
                        task: task,
                        tokensText: _tokensCache[task.id],
                        onTap: widget.onCreateTask == null
                            ? null
                            : () => widget.onCreateTask!(task),
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SegmentedTabs extends StatelessWidget {
  const _SegmentedTabs({required this.finished, required this.onChange});

  final bool finished;
  final ValueChanged<bool> onChange;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppleRadius.pill),
      ),
      child: Row(
        children: [
          _Tab(
            label: '进行中',
            selected: !finished,
            onTap: () => onChange(false),
          ),
          _Tab(
            label: '已结束',
            selected: finished,
            onTap: () => onChange(true),
          ),
        ],
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: BoxDecoration(
            color: selected ? scheme.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(AppleRadius.pill),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: selected ? scheme.onPrimary : scheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.finished});

  final bool finished;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.task_alt_rounded,
            size: 48,
            color: scheme.onSurfaceVariant,
          ),
          const SizedBox(height: 12),
          Text(
            finished ? '暂无已结束任务' : '暂无进行中任务',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            '下拉刷新或从底部 + 新建任务',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
