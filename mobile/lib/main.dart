import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'src/app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    if (kReleaseMode) {
      debugPrint('Uncaught Flutter error: ${details.exceptionAsString()}');
    }
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('Uncaught platform error: $error\n$stack');
    // Return true so the error is considered handled and the app keeps running.
    return true;
  };
  runZonedGuarded(() => runApp(const PiMobileApp()), (error, stack) {
    debugPrint('Uncaught zone error: $error\n$stack');
  });
}
