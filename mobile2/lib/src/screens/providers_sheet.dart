import 'package:flutter/material.dart';

import '../apple_theme.dart';
import '../chat_controller.dart';
import '../localization.dart';
import '../models.dart';

/// 供应商管理：查看 API Key 供应商的配置状态，填写 / 更新 / 删除 Key。
/// 数据来自网页端同款接口（/api/auth/all-providers、/api/auth/api-key/*）。
class ProvidersSheet extends StatefulWidget {
  const ProvidersSheet({super.key, required this.controller});

  final ChatController controller;

  @override
  State<ProvidersSheet> createState() => _ProvidersSheetState();
}

class _ProvidersSheetState extends State<ProvidersSheet> {
  List<ProviderAuthStatus> _providers = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    final providers = await widget.controller.api.getApiKeyProviders();
    if (!mounted) return;
    setState(() {
      _providers = providers;
      _loading = false;
    });
  }

  Future<void> _editProvider(ProviderAuthStatus provider) async {
    final controller = TextEditingController();
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          bottom: MediaQuery.viewInsetsOf(sheetContext).bottom + 16,
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                provider.displayName,
                style: Theme.of(
                  sheetContext,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Text(
                sheetContext.tr(
                  provider.configured ? '已配置，可更新或删除 Key' : '尚未配置 API Key',
                ),
                style: Theme.of(sheetContext).textTheme.bodySmall?.copyWith(
                  color: Theme.of(sheetContext).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: controller,
                autofocus: true,
                obscureText: true,
                autocorrect: false,
                enableSuggestions: false,
                decoration: InputDecoration(
                  labelText: sheetContext.tr('API Key'),
                  hintText: sheetContext.tr('粘贴新的 API Key'),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () async {
                  final key = controller.text.trim();
                  if (key.isEmpty) {
                    ScaffoldMessenger.of(sheetContext).showSnackBar(
                      SnackBar(content: Text(sheetContext.tr('请输入 API Key'))),
                    );
                    return;
                  }
                  final ok = await widget.controller.api.setProviderApiKey(
                    provider.id,
                    key,
                  );
                  if (sheetContext.mounted) {
                    Navigator.pop(sheetContext, ok ? 'saved' : 'failed');
                  }
                },
                child: Text(sheetContext.tr('保存')),
              ),
              if (provider.configured) ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () async {
                    final ok = await widget.controller.api.deleteProviderApiKey(
                      provider.id,
                    );
                    if (sheetContext.mounted) {
                      Navigator.pop(sheetContext, ok ? 'deleted' : 'failed');
                    }
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Theme.of(sheetContext).colorScheme.error,
                  ),
                  child: Text(sheetContext.tr('删除 Key')),
                ),
              ],
            ],
          ),
        ),
      ),
    );
    if (action != null && mounted) {
      // Let the sheet route finish its exit animation before disposing the
      // shared TextEditingController it may still reference.
      await Future<void>.delayed(const Duration(milliseconds: 250));
      controller.dispose();
      if (action == 'failed') {
        if (mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(context.tr('操作失败，请稍后重试'))));
        }
        return;
      }
      await _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              action == 'saved'
                  ? context.tr('API Key 已保存')
                  : context.tr('API Key 已删除'),
            ),
          ),
        );
      }
    } else {
      // User dismissed without acting.
      await Future<void>.delayed(const Duration(milliseconds: 250));
      controller.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final configured = _providers.where((p) => p.configured).toList();
    final unconfigured = _providers.where((p) => !p.configured).toList();
    return SafeArea(
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * .8,
        ),
        decoration: BoxDecoration(
          color: cs.surface,
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(AppleRadius.panel),
          ),
          boxShadow: AppleShadows.floating,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 8, 6),
              child: Row(
                children: [
                  Icon(Icons.hub_outlined, color: cs.primary),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      context.tr('模型供应商'),
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: _refresh,
                    tooltip: context.tr('刷新'),
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    tooltip: context.tr('关闭'),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_providers.isEmpty)
              Padding(
                padding: const EdgeInsets.all(32),
                child: Center(
                  child: Text(
                    context.tr('没有可配置的供应商'),
                    style: TextStyle(color: cs.onSurfaceVariant),
                  ),
                ),
              )
            else
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    if (configured.isNotEmpty) ...[
                      _sectionLabel(context, context.tr('已配置')),
                      for (final provider in configured)
                        _providerTile(context, provider),
                    ],
                    if (unconfigured.isNotEmpty) ...[
                      _sectionLabel(context, context.tr('未配置')),
                      for (final provider in unconfigured)
                        _providerTile(context, provider),
                    ],
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _sectionLabel(BuildContext context, String text) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 12, 20, 6),
    child: Text(
      text,
      style: Theme.of(context).textTheme.labelMedium?.copyWith(
        color: Theme.of(context).colorScheme.onSurfaceVariant,
        fontWeight: FontWeight.w700,
      ),
    ),
  );

  Widget _providerTile(BuildContext context, ProviderAuthStatus provider) {
    final cs = Theme.of(context).colorScheme;
    return ListTile(
      leading: provider.configured
          ? Icon(Icons.check_circle_rounded, color: cs.primary)
          : Icon(Icons.circle_outlined, color: cs.outline),
      title: Text(provider.displayName),
      subtitle: Text(
        provider.configured
            ? (provider.source?.isNotEmpty == true
                  ? context.tr('已配置 · {source} · {count} 个模型', {
                      'source': provider.source!,
                      'count': provider.modelCount,
                    })
                  : context.tr('已配置 · {count} 个模型', {
                      'count': provider.modelCount,
                    }))
            : context.tr('未配置 API Key'),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => _editProvider(provider),
    );
  }
}
