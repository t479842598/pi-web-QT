import 'package:flutter_test/flutter_test.dart';
import 'package:pi_web_qt/src/chat_controller.dart';
import 'package:pi_web_qt/src/models.dart';
import 'package:pi_web_qt/src/pi_api.dart';

void main() {
  test('newChat clears messages immediately (no stale content)', () async {
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile));
    controller.messages.add(
      ChatMessage(role: 'assistant', text: '旧会话内容'),
    );
    controller.draftCwd = '/old';

    // newChat 的同步部分应立刻清空消息（不等 loadModels 完成）
    final future = controller.newChat('/mnt/code').catchError((_) {});
    expect(controller.messages, isEmpty,
        reason: '新建会话后应立即清空旧消息，不能等到异步加载完成');
    expect(controller.draftCwd, '/mnt/code');
    await future;
  });

  test('newChat notifies synchronously so UI drops stale content', () async {
    final profile = ServerProfile(
      baseUrl: 'https://example.test',
      username: 'pi',
      password: 'test-only',
    );
    final controller = ChatController(PiApi(profile));
    controller.messages.add(
      ChatMessage(role: 'assistant', text: '旧会话内容'),
    );
    controller.draftCwd = '/old';

    var notifications = 0;
    controller.addListener(() => notifications++);
    final future = controller.newChat('/mnt/code').catchError((_) {});
    // 同步 notify 应已触发（列表监听者会 rebuild，消息区清空）
    expect(notifications, greaterThan(0),
        reason: 'newChat 同步部分应立即 notify，UI 才不会继续显示旧内容');
    await future;
  });
}
