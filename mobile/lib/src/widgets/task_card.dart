import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../apple_theme.dart';
import '../models.dart';

/// MonkeyCode-style task card: pulsing status dot, task title, project path
/// (monospace), model chip, tokens, relative time and +N/−N change counts.
class TaskCard extends StatelessWidget {
  const TaskCard({
    super.key,
    required this.task,
    this.tokensText,
    this.onTap,
  });

  final PiTask task;

  /// Pre-rendered tokens string ('' hides it). Fetched lazily by the screen.
  final String? tokensText;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final pi = Theme.of(context).extension<PiWebColors>();
    final statusColor = _statusColor(task.status, pi?.green, scheme.error);
    return Material(
      color: scheme.surface,
      borderRadius: BorderRadius.circular(AppleRadius.card),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _StatusDot(color: statusColor, pulse: task.status.isActive),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      task.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        height: 1.3,
                        color: scheme.onSurface,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _relativeTime(context, task),
                    style: TextStyle(
                      fontSize: 11,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Flexible(
                    child: Text(
                      _projectName(task.projectRoot),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  if (task.modelId != null && task.modelId!.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    _ModelChip(model: task.modelId!, dark: dark),
                  ],
                  const Spacer(),
                  if (tokensText != null && tokensText!.isNotEmpty)
                    Text(
                      tokensText!,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
              if (task.status == TaskStatus.review &&
                  (task.additions != null || task.deletions != null)) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    if (task.additions != null && task.additions! > 0)
                      Text(
                        '+${task.additions}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: pi?.green ?? const Color(0xff16a34a),
                        ),
                      ),
                    if (task.additions != null &&
                        task.additions! > 0 &&
                        task.deletions != null &&
                        task.deletions! > 0)
                      const SizedBox(width: 8),
                    if (task.deletions != null && task.deletions! > 0)
                      Text(
                        '−${task.deletions}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: scheme.error,
                        ),
                      ),
                    const SizedBox(width: 8),
                    Text(
                      task.failureReason ?? '',
                      style: TextStyle(
                        fontSize: 12,
                        color: task.status == TaskStatus.failed
                            ? scheme.error
                            : scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

Color _statusColor(TaskStatus status, Color? green, Color error) =>
    switch (status) {
      TaskStatus.running => green ?? const Color(0xff16a34a),
      TaskStatus.awaitingInput => const Color(0xffd29922),
      TaskStatus.failed => error,
      TaskStatus.done => green ?? const Color(0xff16a34a),
      _ => const Color(0xff8a8a8a),
    };

String _projectName(String projectRoot) {
  final trimmed = projectRoot.endsWith('/')
      ? projectRoot.substring(0, projectRoot.length - 1)
      : projectRoot;
  final idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.substring(idx + 1) : trimmed;
}

String _relativeTime(BuildContext context, PiTask task) {
  final time = task.finishedAt ?? task.createdAt;
  if (time == null) return '';
  final now = DateTime.now();
  final diff = now.difference(time);
  if (diff.inMinutes < 1) return '刚刚';
  if (diff.inHours < 1) return '${diff.inMinutes} 分钟前';
  if (diff.inDays < 1) return '${diff.inHours} 小时前';
  if (diff.inDays < 30) return '${diff.inDays} 天前';
  return DateFormat('yyyy-MM-dd').format(time);
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.color, required this.pulse});

  final Color color;
  final bool pulse;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 18,
      height: 18,
      child: Center(
        child: pulse
            ? _PulsingDot(color: color)
            : Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
      ),
    );
  }
}

class _PulsingDot extends StatefulWidget {
  const _PulsingDot({required this.color});

  final Color color;

  @override
  State<_PulsingDot> createState() => _PulsingDotState();
}

class _PulsingDotState extends State<_PulsingDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 800),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = _controller.value;
        final opacity = 0.35 + 0.65 * (1 - t);
        return Container(
          width: 8 + 6 * t,
          height: 8 + 6 * t,
          decoration: BoxDecoration(
            color: widget.color.withValues(alpha: opacity),
            shape: BoxShape.circle,
          ),
        );
      },
    );
  }
}

class _ModelChip extends StatelessWidget {
  const _ModelChip({required this.model, required this.dark});

  final String model;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: scheme.primary.withValues(alpha: dark ? .18 : .1),
        borderRadius: BorderRadius.circular(AppleRadius.pill),
      ),
      child: Text(
        model,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: scheme.primary,
        ),
      ),
    );
  }
}
