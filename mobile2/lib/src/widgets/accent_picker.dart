import 'package:flutter/material.dart';

import '../apple_theme.dart';

/// Row of circular accent swatches. The selected swatch gets a white ring
/// plus a check mark; the row scrolls horizontally when it overflows.
class AccentPicker extends StatelessWidget {
  const AccentPicker({
    super.key,
    required this.selected,
    required this.onChanged,
    this.labels = const {},
  });

  /// Currently selected accent color.
  final Color selected;

  /// Called when the user taps a swatch.
  final ValueChanged<Color> onChanged;

  /// Optional label overrides keyed by accent name ('green', 'blue', …).
  final Map<String, String> labels;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final (name, labelKey) in appleAccentChoices)
            _Swatch(
              name: name,
              color: accentByName(name),
              selected: accentByName(name) == selected,
              label: labels[name] ?? labelKey,
              scheme: scheme,
              onTap: () => onChanged(accentByName(name)),
            ),
        ],
      ),
    );
  }
}

class _Swatch extends StatelessWidget {
  const _Swatch({
    required this.name,
    required this.color,
    required this.selected,
    required this.label,
    required this.scheme,
    required this.onTap,
  });

  final String name;
  final Color color;
  final bool selected;
  final String label;
  final ColorScheme scheme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Semantics(
        label: label,
        selected: selected,
        button: true,
        child: GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 160),
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                  border: selected
                      ? Border.all(color: scheme.surface, width: 2.5)
                      : null,
                  boxShadow: selected
                      ? [
                          BoxShadow(
                            color: color.withValues(alpha: .45),
                            blurRadius: 8,
                            offset: const Offset(0, 2),
                          ),
                        ]
                      : null,
                ),
                child: selected
                    ? Icon(
                        Icons.check_rounded,
                        size: 20,
                        color: scheme.surface,
                      )
                    : null,
              ),
              const SizedBox(height: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  color: selected
                      ? scheme.onSurface
                      : scheme.onSurfaceVariant,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
