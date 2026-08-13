import 'dart:ui';

import 'package:flutter/material.dart';

abstract final class AppleColors {
  // ── Light palette (matches pi-web default light) ──────────────────
  static const accent = Color(0xff0d9488);
  static const ground = Color(0xffffffff);
  static const surface = Color(0xfff5f5f5);
  static const text = Color(0xff1a1a1a);
  static const textSecondary = Color(0xff555555);
  static const textTertiary = Color(0xff888888);
  static const faint = Color(0xffe0e0e0);
  static const hairline = Color(0x1a000000);

  // ── Dark palette (matches pi-web default dark) ────────────────────
  static const darkGround = Color(0xff1a1a1a);
  static const darkSurface = Color(0xff242424);
  static const darkSurfaceRaised = Color(0xff2e2e2e);
  static const darkText = Color(0xffe8e8e8);
  static const darkSecondary = Color(0xff888888);
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
    primaryContainer: dark ? const Color(0xff0f3d3a) : const Color(0xffe6f7f5),
    onPrimaryContainer: dark
        ? const Color(0xffb2e5df)
        : const Color(0xff0b5f56),
    secondary: AppleColors.accent,
    onSecondary: Colors.white,
    secondaryContainer: dark
        ? AppleColors.darkSurfaceRaised
        : const Color(0xffe6f7f5),
    onSecondaryContainer: text,
    error: dark ? const Color(0xfff87171) : const Color(0xffdc2626),
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
    inversePrimary: dark ? const Color(0xff96e1d8) : const Color(0xff0d9488),
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
    extensions: [
      PiWebColors(
        userBg: dark ? const Color(0xff1e2a2b) : const Color(0xffeff6ff),
        toolBg: dark ? const Color(0xff171c1c) : const Color(0xfff9fafb),
        selected: dark ? const Color(0xff383838) : const Color(0xffe8e8e8),
        green: dark ? const Color(0xff3fb950) : const Color(0xff16a34a),
        orange: dark ? const Color(0xffd29922) : const Color(0xffd97706),
      ),
    ],
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

/// Extra web-client color tokens surfaced through the theme so chat bubbles,
/// tool cards and status colors follow the selected theme set. Falls back to
/// the web default palette when the theme omits them.
class PiWebColors extends ThemeExtension<PiWebColors> {
  const PiWebColors({
    required this.userBg,
    required this.toolBg,
    required this.selected,
    required this.green,
    required this.orange,
  });

  final Color userBg;
  final Color toolBg;
  final Color selected;
  final Color green;
  final Color orange;

  @override
  PiWebColors copyWith({
    Color? userBg,
    Color? toolBg,
    Color? selected,
    Color? green,
    Color? orange,
  }) => PiWebColors(
    userBg: userBg ?? this.userBg,
    toolBg: toolBg ?? this.toolBg,
    selected: selected ?? this.selected,
    green: green ?? this.green,
    orange: orange ?? this.orange,
  );

  @override
  PiWebColors lerp(ThemeExtension<PiWebColors>? other, double t) {
    if (other is! PiWebColors) return this;
    return PiWebColors(
      userBg: Color.lerp(userBg, other.userBg, t)!,
      toolBg: Color.lerp(toolBg, other.toolBg, t)!,
      selected: Color.lerp(selected, other.selected, t)!,
      green: Color.lerp(green, other.green, t)!,
      orange: Color.lerp(orange, other.orange, t)!,
    );
  }
}

/// Parses a `#rrggbb` / `#aarrggbb` hex string into a [Color]. Returns null
/// for unparsable values so callers can fall back gracefully.
Color? colorFromHex(String? hex) {
  if (hex == null) return null;
  var value = hex.trim();
  if (!value.startsWith('#')) return null;
  value = value.substring(1);
  if (value.length == 3) {
    value = value.split('').map((c) => '$c$c').join();
  }
  if (value.length != 6 && value.length != 8) return null;
  final parsed = int.tryParse(value, radix: 16);
  if (parsed == null) return null;
  if (value.length == 6) return Color(0xff000000 | parsed);
  return Color(parsed);
}

/// Builds a Flutter [ThemeData] from a resolved web theme's CSS variables.
/// The server emits kebab-case keys (`bg-panel`, `user-bg`, `accent-red`, …)
/// after the `--` prefix is stripped. Missing keys fall back to the built-in
/// Apple palette so a partial theme never produces unreadable UI.
ThemeData buildThemeFromVars(Map<String, String> vars, {required bool dark}) {
  Color fallback(String key, Color builtin) =>
      colorFromHex(vars[key]) ?? builtin;
  final accent = fallback('accent', AppleColors.accent);
  final ground = fallback(
    'bg',
    dark ? AppleColors.darkGround : AppleColors.ground,
  );
  final panel = fallback(
    'bg-panel',
    dark ? AppleColors.darkSurface : AppleColors.surface,
  );
  final hover = fallback(
    'bg-hover',
    dark ? AppleColors.darkSurfaceRaised : const Color(0xffeeeeee),
  );
  final selected = fallback(
    'bg-selected',
    dark ? const Color(0xff383838) : const Color(0xffe8e8e8),
  );
  final border = fallback(
    'border',
    dark ? const Color(0xff3a3a3a) : const Color(0xffe0e0e0),
  );
  final text = fallback('text', dark ? AppleColors.darkText : AppleColors.text);
  final muted = fallback(
    'text-muted',
    dark ? AppleColors.darkSecondary : AppleColors.textSecondary,
  );
  final dim = fallback(
    'text-dim',
    dark ? const Color(0xff555555) : const Color(0xff888888),
  );
  final userBg = fallback(
    'user-bg',
    dark ? const Color(0xff1e2a2b) : const Color(0xffeff6ff),
  );
  final toolBg = fallback(
    'tool-bg',
    dark ? const Color(0xff171c1c) : const Color(0xfff9fafb),
  );
  final error = fallback(
    'accent-red',
    dark ? const Color(0xfff87171) : const Color(0xffdc2626),
  );
  final green = fallback(
    'accent-green',
    dark ? const Color(0xff3fb950) : const Color(0xff16a34a),
  );
  final orange = fallback(
    'accent-orange',
    dark ? const Color(0xffd29922) : const Color(0xffd97706),
  );

  final scheme = ColorScheme(
    brightness: dark ? Brightness.dark : Brightness.light,
    primary: accent,
    onPrimary: Colors.white,
    primaryContainer: accent.withValues(alpha: .14),
    onPrimaryContainer: accent,
    secondary: accent,
    onSecondary: Colors.white,
    secondaryContainer: accent.withValues(alpha: .14),
    onSecondaryContainer: text,
    error: error,
    onError: Colors.white,
    surface: panel,
    onSurface: text,
    surfaceContainerLowest: ground,
    surfaceContainerLow: panel,
    surfaceContainer: hover,
    surfaceContainerHigh: hover,
    surfaceContainerHighest: hover,
    onSurfaceVariant: muted,
    outline: dim,
    outlineVariant: border,
    shadow: Colors.black,
    scrim: Colors.black,
    inverseSurface: text,
    onInverseSurface: ground,
    inversePrimary: accent,
  );
  final base = ThemeData(
    brightness: dark ? Brightness.dark : Brightness.light,
    colorScheme: scheme,
    useMaterial3: true,
    scaffoldBackgroundColor: ground,
    canvasColor: ground,
    dividerColor: border,
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
      titleLarge: textTheme.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -.3,
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
      backgroundColor: panel,
      modalBackgroundColor: panel,
      surfaceTintColor: Colors.transparent,
      modalBarrierColor: Colors.black.withValues(alpha: .28),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      showDragHandle: true,
      dragHandleColor: border,
      dragHandleSize: const Size(38, 5),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: panel.withValues(alpha: .96),
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppleRadius.hero),
      ),
    ),
    cardTheme: CardThemeData(
      color: panel,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppleRadius.card),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: hover,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppleRadius.sheet),
        borderSide: BorderSide(color: border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppleRadius.sheet),
        borderSide: BorderSide(color: border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppleRadius.sheet),
        borderSide: BorderSide(color: accent, width: 1.4),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: accent,
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
        side: BorderSide(color: border),
        shape: const StadiumBorder(),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: accent,
        minimumSize: const Size(44, 44),
        shape: const StadiumBorder(),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(minimumSize: const Size(44, 44)),
    ),
    listTileTheme: ListTileThemeData(
      minTileHeight: 52,
      iconColor: muted,
      textColor: text,
      selectedColor: accent,
      selectedTileColor: accent.withValues(alpha: dark ? .18 : .08),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    dividerTheme: DividerThemeData(color: border, thickness: 1, space: 1),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: dark ? hover : text,
      contentTextStyle: const TextStyle(color: Colors.white),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    extensions: [
      PiWebColors(
        userBg: userBg,
        toolBg: toolBg,
        selected: selected,
        green: green,
        orange: orange,
      ),
    ],
  );
}
