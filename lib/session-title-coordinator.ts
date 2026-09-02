const MAX_ACTIVE_TITLE_TASKS = 2;
const MAX_QUEUED_TITLE_TASKS = 20;

export class SessionTitleTaskError extends Error {
  constructor(
    message: string,
    public readonly code: "title_queue_full" | "title_generation_cancelled",
  ) {
    super(message);
    this.name = "SessionTitleTaskError";
  }
}

interface TitleTask<T = unknown> {
  sessionId: string;
  controller: AbortController;
  execute: (signal: AbortSignal) => Promise<T>;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  state: "queued" | "running";
}

interface TitleCoordinatorState {
  active: number;
  tasks: Map<string, TitleTask>;
  queue: TitleTask[];
}

declare global {
  var __piSessionTitleCoordinator: TitleCoordinatorState | undefined;
}

function state(): TitleCoordinatorState {
  return (globalThis.__piSessionTitleCoordinator ??= {
    active: 0,
    tasks: new Map(),
    queue: [],
  });
}

function cancelledError(): SessionTitleTaskError {
  return new SessionTitleTaskError("Session title generation was cancelled", "title_generation_cancelled");
}

function settleTask(task: TitleTask): void {
  const current = state();
  if (current.tasks.get(task.sessionId) === task) current.tasks.delete(task.sessionId);
  current.active = Math.max(0, current.active - 1);
  drain();
}

function run(task: TitleTask): void {
  const current = state();
  if (task.controller.signal.aborted) {
    current.tasks.delete(task.sessionId);
    task.reject(cancelledError());
    drain();
    return;
  }
  task.state = "running";
  current.active += 1;
  void task.execute(task.controller.signal).then(task.resolve, task.reject).finally(() => settleTask(task));
}

function drain(): void {
  const current = state();
  while (current.active < MAX_ACTIVE_TITLE_TASKS && current.queue.length > 0) {
    const task = current.queue.shift();
    if (task) run(task);
  }
}

export function scheduleSessionTitle<T>(
  sessionId: string,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const current = state();
  const existing = current.tasks.get(sessionId);
  if (existing) return existing.promise as Promise<T>;

  if (current.active >= MAX_ACTIVE_TITLE_TASKS && current.queue.length >= MAX_QUEUED_TITLE_TASKS) {
    throw new SessionTitleTaskError("Too many session title requests are waiting", "title_queue_full");
  }

  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const task: TitleTask<T> = {
    sessionId,
    controller: new AbortController(),
    execute,
    promise,
    resolve,
    reject,
    state: "queued",
  };
  current.tasks.set(sessionId, task as TitleTask);
  if (current.active < MAX_ACTIVE_TITLE_TASKS) run(task as TitleTask);
  else current.queue.push(task as TitleTask);
  return promise;
}

export function cancelSessionTitle(sessionId: string): boolean {
  const current = state();
  const task = current.tasks.get(sessionId);
  if (!task) return false;
  task.controller.abort();
  if (task.state === "queued") {
    const index = current.queue.indexOf(task);
    if (index >= 0) current.queue.splice(index, 1);
    current.tasks.delete(sessionId);
    task.reject(cancelledError());
    drain();
  }
  return true;
}

export function getSessionTitleCoordinatorSnapshot(): {
  active: number;
  queued: number;
  sessionIds: string[];
} {
  const current = state();
  return {
    active: current.active,
    queued: current.queue.length,
    sessionIds: [...current.tasks.keys()],
  };
}

export function resetSessionTitleCoordinatorForTests(): void {
  const current = state();
  for (const task of current.tasks.values()) task.controller.abort();
  globalThis.__piSessionTitleCoordinator = undefined;
}
