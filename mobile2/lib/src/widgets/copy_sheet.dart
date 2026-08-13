import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../apple_theme.dart';
import '../localization.dart';

/// Long-press copy panel (MonkeyCode CopySheet). Because the chat uses an
/// inverted list, native text selection is unreliable there — this panel
/// shows the text in a normal-layer selectable field plus a "copy all"
/// button.
Future<void> showCopySheet(
  BuildContext context, {
  required String text,
  required String title,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (sheetContext) {
      final scheme = Theme.of(sheetContext).colorScheme;
      return Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              title,
              style: Theme.of(sheetContext).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Container(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.45,
              ),
              decoration: BoxDecoration(
                color: scheme.surfaceContainer,
                borderRadius: BorderRadius.circular(AppleRadius.lg),
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(14),
                child: SelectableText(
                  text,
                  style: const TextStyle(fontSize: 14, height: 1.6),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(sheetContext),
                    child: Text(context.tr('取消')),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () async {
                      final copiedLabel = context.tr('已复制');
                      final messenger = ScaffoldMessenger.of(sheetContext);
                      await Clipboard.setData(ClipboardData(text: text));
                      if (sheetContext.mounted) {
                        Navigator.pop(sheetContext);
                        messenger.showSnackBar(
                          SnackBar(content: Text(copiedLabel)),
                        );
                      }
                    },
                    icon: const Icon(Icons.copy_rounded, size: 18),
                    label: Text(context.tr('复制全部')),
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    },
  );
}
