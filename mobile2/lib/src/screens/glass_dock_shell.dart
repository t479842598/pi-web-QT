import 'package:flutter/material.dart';

import '../chat_controller.dart';
import '../models.dart';
import 'new_task_sheet.dart';
import 'profile_screen.dart';
import 'projects_screen.dart';
import 'tasks_screen.dart';
import '../widgets/glass_dock.dart';

/// The logged-in home shell: three root tabs (Tasks / Projects / Me) kept
/// alive in an [IndexedStack], with the floating [GlassDock] at the bottom.
/// Detail screens (chat) are pushed on top of this shell.
class GlassDockShell extends StatefulWidget {
  const GlassDockShell({
    super.key,
    required this.controller,
    required this.profile,
    this.onOpenTask,
    this.onNew,
  });

  final ChatController controller;
  final ServerProfile profile;

  /// Called when a session/task should open the full chat screen.
  final void Function(PiTask task)? onOpenTask;

  /// Called when the central `+` button is tapped (opens the new-task sheet).
  final VoidCallback? onNew;

  @override
  State<GlassDockShell> createState() => _GlassDockShellState();
}

class _GlassDockShellState extends State<GlassDockShell> {
  int _tabIndex = 0;

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _tabIndex == 0,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && _tabIndex != 0) {
          setState(() => _tabIndex = 0);
        }
      },
      child: Scaffold(
        backgroundColor: Theme.of(context).colorScheme.surfaceContainerLowest,
        body: Stack(
          children: [
            IndexedStack(
              index: _tabIndex,
              children: [
                TasksScreen(
                  controller: widget.controller,
                  onCreateTask: widget.onOpenTask,
                ),
                ProjectsScreen(controller: widget.controller),
                ProfileScreen(controller: widget.controller),
              ],
            ),
            GlassDock(
              currentIndex: _tabIndex,
              onSelect: (index) => setState(() => _tabIndex = index),
              onFab: () {
                final onCreate = widget.onNew;
                if (onCreate != null) {
                  onCreate();
                } else {
                  showNewTaskSheet(context, controller: widget.controller);
                }
              },
              fabTooltip: 'New task',
            ),
          ],
        ),
      ),
    );
  }
}
