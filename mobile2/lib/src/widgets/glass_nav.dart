import 'package:flutter/material.dart';

import '../apple_theme.dart';

/// Root-screen floating header: a large title pinned to the top that fades
/// into a frosted bar once the content scrolls under it (MonkeyCode
/// GlassTop). Used as the `header` of a [CustomScrollView]'s sliver list.
class GlassTopHeader extends StatelessWidget {
  const GlassTopHeader({
    super.key,
    required this.title,
    this.actions = const [],
    this.subtitle,
  });

  final String title;
  final Widget? subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final topInset = MediaQuery.paddingOf(context).top;
    return SliverAppBar(
      pinned: true,
      floating: true,
      stretch: false,
      toolbarHeight: 76,
      elevation: 0,
      scrolledUnderElevation: 0,
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      automaticallyImplyLeading: false,
      flexibleSpace: FlexibleSpaceBar(
        titlePadding: EdgeInsets.fromLTRB(20, topInset + 10, 20, 12),
        title: Align(
          alignment: Alignment.centerLeft,
          child: Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 31,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.9,
              color: scheme.onSurface,
            ),
          ),
        ),
        background: GlassTopBar(),
      ),
      actions: actions,
    );
  }
}

/// The frosted bar behind the [GlassTopHeader] title — fades in as the
/// header scrolls under (handled by SliverAppBar's scrolledUnder state).
class GlassTopBar extends StatelessWidget {
  const GlassTopBar({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final color = dark ? AppleColors.darkSurface : AppleColors.surface;
    return Container(
      decoration: BoxDecoration(
        color: color.withValues(alpha: .0),
        border: Border(
          bottom: BorderSide(
            color: (dark ? AppleColors.darkHairline : AppleColors.hairline),
          ),
        ),
      ),
    );
  }
}

/// Detail-screen navigation bar: back arrow + centered title + trailing
/// action slot, with a large bottom-left radius (MonkeyCode GlassNav).
class GlassNav extends StatelessWidget implements PreferredSizeWidget {
  const GlassNav({
    super.key,
    required this.title,
    this.trailing,
    this.onBack,
    this.leading,
  });

  final String title;
  final Widget? trailing;
  final Widget? leading;
  final VoidCallback? onBack;

  @override
  Size get preferredSize => const Size.fromHeight(56);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final color = dark ? AppleColors.darkSurface : AppleColors.surface;
    final topInset = MediaQuery.paddingOf(context).top;
    return Container(
      margin: EdgeInsets.only(top: topInset),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .92),
        border: Border(
          bottom: BorderSide(
            color: dark ? AppleColors.darkHairline : AppleColors.hairline,
          ),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.only(left: 4, right: 8),
        child: Row(
          children: [
            leading ??
                IconButton(
                  onPressed: onBack ?? () => Navigator.maybePop(context),
                  icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
                  tooltip: 'Back',
                ),
            Expanded(
              child: Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -0.3,
                  color: scheme.onSurface,
                ),
              ),
            ),
            SizedBox(width: 48, child: trailing),
          ],
        ),
      ),
    );
  }
}
