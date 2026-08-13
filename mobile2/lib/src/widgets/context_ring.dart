import 'package:flutter/material.dart';

/// 24px context-usage ring (MonkeyCode style): a thin progress arc around a
/// percentage. Colors: <60% green (accent), ≥60% amber, ≥80% red.
class ContextRing extends StatelessWidget {
  const ContextRing({
    super.key,
    this.size = 24,
    this.percent = 0,
    this.color,
  });

  final double size;

  /// Usage fraction 0..1 (clamped).
  final double percent;

  /// Optional override; defaults to the threshold color.
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final effective = percent.clamp(0.0, 1.0);
    final fillColor =
        color ??
        (effective >= 0.8
            ? scheme.error
            : effective >= 0.6
            ? const Color(0xffd29922)
            : scheme.primary);
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _RingPainter(
          progress: effective,
          trackColor: scheme.outlineVariant,
          fillColor: fillColor,
          textColor: scheme.onSurfaceVariant,
          strokeWidth: 2,
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  const _RingPainter({
    required this.progress,
    required this.trackColor,
    required this.fillColor,
    required this.textColor,
    required this.strokeWidth,
  });

  final double progress;
  final Color trackColor;
  final Color fillColor;
  final Color textColor;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - strokeWidth) / 2;
    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..color = trackColor;
    canvas.drawCircle(center, radius, track);

    if (progress > 0) {
      final arc = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.round
        ..color = fillColor;
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        -3.14159265 / 2,
        6.28318530 * progress,
        false,
        arc,
      );
    }

    final percentage = (progress * 100).round();
    if (size.width >= 22) {
      final textPainter = TextPainter(
        text: TextSpan(
          text: '$percentage',
          style: TextStyle(
            fontSize: size.width * 0.32,
            fontWeight: FontWeight.w600,
            color: textColor,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      textPainter.paint(
        canvas,
        Offset(
          (size.width - textPainter.width) / 2,
          (size.height - textPainter.height) / 2,
        ),
      );
    }
  }

  @override
  bool shouldRepaint(_RingPainter oldDelegate) =>
      oldDelegate.progress != progress ||
      oldDelegate.fillColor != fillColor ||
      oldDelegate.trackColor != trackColor ||
      oldDelegate.textColor != textColor;
}
