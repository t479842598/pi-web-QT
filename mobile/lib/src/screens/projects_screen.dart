import 'package:flutter/material.dart';

import '../chat_controller.dart';
import '../localization.dart';

/// MonkeyCode-style root "Projects" screen. Hosts the session list (which
/// lives in the left drawer today); filled incrementally by later specs.
class ProjectsScreen extends StatelessWidget {
  const ProjectsScreen({super.key, required this.controller});

  final ChatController controller;

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
      slivers: [
        SliverAppBar(
          pinned: true,
          floating: true,
          toolbarHeight: 76,
          elevation: 0,
          scrolledUnderElevation: 0,
          backgroundColor: Colors.transparent,
          surfaceTintColor: Colors.transparent,
          automaticallyImplyLeading: false,
          flexibleSpace: FlexibleSpaceBar(
            titlePadding: EdgeInsets.fromLTRB(
              20,
              MediaQuery.paddingOf(context).top + 10,
              20,
              12,
            ),
            title: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                context.tr('项目'),
                style: TextStyle(
                  fontSize: 31,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.9,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
            ),
          ),
        ),
        SliverFillRemaining(
          hasScrollBody: false,
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.folder_rounded,
                  size: 48,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(height: 12),
                Text(
                  context.tr('暂无项目'),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
