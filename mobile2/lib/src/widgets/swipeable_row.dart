import 'package:flutter/material.dart';

/// MonkeyCode-style swipe-to-reveal row. Drag left to reveal action buttons
/// (amber = cancel for running tasks, red = delete for finished ones).
/// Implemented with a plain GestureDetector — no third-party gesture lib.
class SwipeableRow extends StatefulWidget {
  const SwipeableRow({
    super.key,
    required this.child,
    required this.actions,
    this.actionWidth = 78,
    this.dismissThreshold = 60,
  });

  final Widget child;

  /// Action buttons rendered on the right; each should be fixed-width so the
  /// revealed area is [actions.length * actionWidth].
  final List<Widget> actions;
  final double actionWidth;
  final double dismissThreshold;

  @override
  State<SwipeableRow> createState() => _SwipeableRowState();
}

class _SwipeableRowState extends State<SwipeableRow>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 200),
  );
  bool _open = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  double get _maxOffset => widget.actions.length * widget.actionWidth;

  void _settle() {
    final target = _open ? 1.0 : 0.0;
    _controller.animateTo(
      target,
      curve: Curves.easeOutCubic,
    );
  }

  void _onHorizontalDragUpdate(DragUpdateDetails details) {
    final total = widget.actionWidth * widget.actions.length;
    // Clamp between 0 (closed) and total (fully open).
    final proposed = _controller.value * total - details.delta.dx;
    _controller.value = (proposed.clamp(0.0, total)) / total;
  }

  void _onHorizontalDragEnd(DragEndDetails details) {
    final openFraction = _controller.value;
    final velocity = details.primaryVelocity ?? 0;
    _open = velocity < -300 || (openFraction > 0.5 && velocity <= 0);
    _settle();
  }

  void close() {
    if (!_open) return;
    setState(() => _open = false);
    _settle();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onHorizontalDragUpdate: _onHorizontalDragUpdate,
      onHorizontalDragEnd: _onHorizontalDragEnd,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Stack(
          children: [
            // Actions behind the content.
            Positioned.fill(
              right: 0,
              child: Align(
                alignment: Alignment.centerRight,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: widget.actions,
                ),
              ),
            ),
            // Content that slides right when opened.
            AnimatedBuilder(
              animation: _controller,
              builder: (context, child) => Transform.translate(
                offset: Offset(-_controller.value * _maxOffset, 0),
                child: child,
              ),
              child: widget.child,
            ),
          ],
        ),
      ),
    );
  }
}

/// One fixed-width action button inside a [SwipeableRow].
class SwipeActionButton extends StatelessWidget {
  const SwipeActionButton({
    super.key,
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
    this.width = 78,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;
  final double width;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: Material(
        color: color,
        child: InkWell(
          onTap: onTap,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 20, color: Colors.white),
              const SizedBox(height: 4),
              Text(
                label,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
