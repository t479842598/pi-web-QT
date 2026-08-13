import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 全局字体缩放（0.8 小 ~ 1.3 大，1.0 标准）。
/// 用 ValueNotifier 全局共享：app.dart 的 builder 监听应用，
/// 设置抽屉直接修改 —— 无需层层传参。
final ValueNotifier<double> fontScaleNotifier = ValueNotifier<double>(1.0);

/// 读取持久化的字体缩放。
Future<void> loadFontScale() async {
  final preferences = await SharedPreferences.getInstance();
  fontScaleNotifier.value = (preferences.getDouble('pi-font-scale') ?? 1.0)
      .clamp(0.8, 1.3);
}

/// 修改并持久化字体缩放。
Future<void> setFontScale(double scale) async {
  final clamped = scale.clamp(0.8, 1.3);
  fontScaleNotifier.value = clamped;
  final preferences = await SharedPreferences.getInstance();
  await preferences.setDouble('pi-font-scale', clamped);
}
