import 'dart:ui';

import 'package:flutter/material.dart';

abstract final class AppleColors {
  static const accent = Color(0xff0071e3);
  static const ground = Color(0xfff5f5f7);
  static const surface = Color(0xffffffff);
  static const text = Color(0xff1d1d1f);
  static const textSecondary = Color(0xff6e6e73);
  static const textTertiary = Color(0xff86868b);
  static const faint = Color(0xffd2d2d7);
  static const hairline = Color(0x12000000);

  static const darkGround = Color(0xff000000);
  static const darkSurface = Color(0xff1c1c1e);
  static const darkSurfaceRaised = Color(0xff2c2c2e);
  static const darkText = Color(0xfff5f5f7);
  static const darkSecondary = Color(0xffaeaeb2);
  static const darkHairline = Color(0x24ffffff);
}

abstract final class AppleRadius {
  static const thumb = 12.0;
  static const sheet = 16.0;
  static const card = 18.0;
  static const panel = 22.0;
  static const hero = 26.0;
}

abstract final class AppleShadows {
  static const card = <BoxShadow>[
    BoxShadow(color: Color(0x0a000000), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x0d000000), blurRadius: 24, offset: Offset(0, 8)),
  ];
  static const panel = <BoxShadow>[
    BoxShadow(color: Color(0x0d000000), blurRadius: 3, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x0d000000), blurRadius: 40, offset: Offset(0, 14)),
  ];
  static const floating = <BoxShadow>[
    BoxShadow(color: Color(0x0d000000), blurRadius: 3, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x1a000000), blurRadius: 32, offset: Offset(0, 12)),
  ];
}

ThemeData buildAppleTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final ground = dark ? AppleColors.darkGround : AppleColors.ground;
  final surface = dark ? AppleColors.darkSurface : AppleColors.surface;
  final raised = dark ? AppleColors.darkSurfaceRaised : AppleColors.surface;
  final text = dark ? AppleColors.darkText : AppleColors.text;
  final secondary = dark
      ? AppleColors.darkSecondary
      : AppleColors.textSecondary;
  final hairline = dark ? AppleColors.darkHairline : AppleColors.hairline;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: AppleColors.accent,
    onPrimary: Colors.white,
    primaryContainer: dark ? const Color(0xff0a3b66) : const Color(0xffe8f2ff),
    onPrimaryContainer: dark
        ? const Color(0xffd6eaff)
        : const Color(0xff004a93),
    secondary: AppleColors.accent,
    onSecondary: Colors.white,
    secondaryContainer: dark
        ? AppleColors.darkSurfaceRaised
        : const Color(0xffe8f2ff),
    onSecondaryContainer: text,
    error: dark ? const Color(0xffff6961) : const Color(0xffd70015),
    onError: Colors.white,
    surface: surface,
    onSurface: text,
    surfaceContainerLowest: ground,
    surfaceContainerLow: surface,
    surfaceContainer: raised,
    surfaceContainerHigh: raised,
    surfaceContainerHighest: raised,
    onSurfaceVariant: secondary,
    outline: dark ? const Color(0xff636366) : AppleColors.textTertiary,
    outlineVariant: hairline,
    shadow: Colors.black,
    scrim: Colors.black,
    inverseSurface: text,
    onInverseSurface: ground,
    inversePrimary: const Color(0xff64a9ff),
  );
  final base = ThemeData(
    brightness: brightness,
    colorScheme: scheme,
    useMaterial3: true,
    scaffoldBackgroundColor: ground,
    canvasColor: ground,
    dividerColor: hairline,
    splashFactory: InkRipple.splashFactory,
  );
  final textTheme = base.textTheme.apply(bodyColor: text, displayColor: text);
  return base.copyWith(
    textTheme: textTheme.copyWith(
      headlineLarge: textTheme.headlineLarge?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -1.0,
      ),
      headlineMedium: textTheme.headlineMedium?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -.7,
      ),
      headlineSmall: textTheme.headlineSmall?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -.4,
      ),
      titleLarge: textTheme.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -.3,
      ),
      titleMedium: textTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w600,
        letterSpacing: -.15,
      ),
      bodyLarge: textTheme.bodyLarge?.copyWith(height: 1.65),
      bodyMedium: textTheme.bodyMedium?.copyWith(height: 1.55),
    ),
    appBarTheme: AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 0,
      backgroundColor: ground.withValues(alpha: .78),
      foregroundColor: text,
      surfaceTintColor: Colors.transparent,
    ),
    drawerTheme: DrawerThemeData(
      backgroundColor: ground.withValues(alpha: .92),
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.horizontal(right: Radius.circular(22)),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: surface,
      modalBackgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      modalBarrierColor: Colors.black.withValues(alpha: .28),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      showDragHandle: true,
      dragHandleColor: dark ? const Color(0xff636366) : AppleColors.faint,
      dragHandleSize: const Size(38, 5),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: surface.withValues(alpha: .96),
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppleRadius.hero),
      ),
    ),
    cardTheme: CardThemeData(
      color: surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppleRadius.card),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: raised,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppleRadius.sheet),
        borderSide: BorderSide(color: hairline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppleRadius.sheet),
        borderSide: BorderSide(color: hairline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppleRadius.sheet),
        borderSide: const BorderSide(color: AppleColors.accent, width: 1.4),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppleColors.accent,
        foregroundColor: Colors.white,
        minimumSize: const Size(44, 44),
        padding: const EdgeInsets.symmetric(horizontal: 20),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: text,
        minimumSize: const Size(44, 44),
        side: BorderSide(color: hairline),
        shape: const StadiumBorder(),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: AppleColors.accent,
        minimumSize: const Size(44, 44),
        shape: const StadiumBorder(),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(minimumSize: const Size(44, 44)),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: dark
          ? AppleColors.darkSurfaceRaised
          : const Color(0x0d000000),
      selectedColor: dark ? const Color(0xff0a3b66) : const Color(0x140071e3),
      side: BorderSide.none,
      shape: const StadiumBorder(),
      labelStyle: TextStyle(color: secondary, fontWeight: FontWeight.w500),
    ),
    listTileTheme: ListTileThemeData(
      minTileHeight: 52,
      iconColor: secondary,
      textColor: text,
      selectedColor: AppleColors.accent,
      selectedTileColor: AppleColors.accent.withValues(alpha: dark ? .18 : .08),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    dividerTheme: DividerThemeData(color: hairline, thickness: 1, space: 1),
    scrollbarTheme: ScrollbarThemeData(
      thumbColor: WidgetStatePropertyAll(secondary.withValues(alpha: .55)),
      radius: const Radius.circular(999),
      thickness: const WidgetStatePropertyAll(4),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: dark ? AppleColors.darkSurfaceRaised : AppleColors.text,
      contentTextStyle: const TextStyle(color: Colors.white),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
  );
}

class AppleGlass extends StatelessWidget {
  const AppleGlass({
    super.key,
    required this.child,
    this.borderRadius = const BorderRadius.all(Radius.circular(22)),
    this.padding,
    this.blur = 20,
  });

  final Widget child;
  final BorderRadius borderRadius;
  final EdgeInsetsGeometry? padding;
  final double blur;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final reduceTransparency = MediaQuery.highContrastOf(context);
    final color = dark ? AppleColors.darkSurface : AppleColors.surface;
    return ClipRRect(
      borderRadius: borderRadius,
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: reduceTransparency ? 0 : blur,
          sigmaY: reduceTransparency ? 0 : blur,
        ),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: color.withValues(alpha: reduceTransparency ? 1 : .82),
            borderRadius: borderRadius,
            border: Border.all(
              color: dark ? AppleColors.darkHairline : AppleColors.hairline,
            ),
          ),
          child: Padding(padding: padding ?? EdgeInsets.zero, child: child),
        ),
      ),
    );
  }
}
