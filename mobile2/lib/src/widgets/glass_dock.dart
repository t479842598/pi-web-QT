import 'package:flutter/material.dart';

import '../apple_theme.dart';

/// MonkeyCode-style floating glass dock: a rounded glass capsule docked at
/// the bottom with three tabs and a central circular FAB. The FAB pops out
/// of the capsule top edge, giving the signature "capsule + FAB" silhouette.
class GlassDock extends StatelessWidget {
  const GlassDock({
    super.key,
    required this.currentIndex,
    required this.onSelect,
    required this.onFab,
    this.tabLabels = const ['任务', '项目', '我的'],
    this.tabIcons = const [
      Icons.task_alt_rounded,
      Icons.folder_rounded,
      Icons.person_rounded,
    ],
    this.fabTooltip,
  });

  /// Index of the selected tab (0..2).
  final int currentIndex;

  /// Called with the tapped tab index.
  final ValueChanged<int> onSelect;

  /// Called when the central `+` button is tapped.
  final VoidCallback onFab;

  final List<String> tabLabels;
  final List<IconData> tabIcons;
  final String? fabTooltip;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    return Positioned(
      left: 20,
      right: 20,
      bottom: bottomInset + 12,
      child: IgnorePointer(
        ignoring: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // The FAB pokes above the capsule — keep it in flow so the
            // capsule can sit below it without overlap issues.
            _FabButton(onTap: onFab, tooltip: fabTooltip, scheme: scheme),
            const SizedBox(height: -14),
            AppleGlass(
              borderRadius: BorderRadius.circular(30),
              solid: true,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    for (var i = 0; i < tabLabels.length; i++) ...[
                      if (i == 1) const SizedBox(width: 44),
                      _DockTab(
                        label: tabLabels[i],
                        icon: tabIcons[i],
                        selected: i == currentIndex,
                        onTap: () => onSelect(i),
                      ),
                      if (i == 1) const SizedBox(width: 44),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FabButton extends StatelessWidget {
  const _FabButton({
    required this.onTap,
    required this.scheme,
    this.tooltip,
  });

  final VoidCallback onTap;
  final ColorScheme scheme;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: _PressableFab(onTap: onTap, scheme: scheme, tooltip: tooltip),
    );
  }
}

class _PressableFab extends StatefulWidget {
  const _PressableFab({
    required this.onTap,
    required this.scheme,
    this.tooltip,
  });

  final VoidCallback onTap;
  final ColorScheme scheme;
  final String? tooltip;

  @override
  State<_PressableFab> createState() => _PressableFabState();
}

class _PressableFabState extends State<_PressableFab> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _pressed ? 0.9 : 1.0,
        duration: const Duration(milliseconds: 120),
        child: Tooltip(
          message: widget.tooltip ?? '',
          child: Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: widget.scheme.primary,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: widget.scheme.primary.withValues(alpha: .45),
                  blurRadius: 16,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: const Icon(Icons.add_rounded, color: Colors.white, size: 28),
          ),
        ),
      ),
    );
  }
}

class _DockTab extends StatelessWidget {
  const _DockTab({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = selected ? scheme.onPrimary : scheme.onSurfaceVariant;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? scheme.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(AppleRadius.pill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 18, color: color),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
