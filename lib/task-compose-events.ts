/**
 * "Turn this message into a work task" hand-off. The board may not be mounted
 * when the event fires (chat view is the default), so the draft is parked in
 * a module-level buffer that the board consumes on mount, with the event as
 * the already-mounted fast path.
 */

export const CREATE_TASK_FROM_TEXT_EVENT = "pi:create-task-from-text";

export interface CreateTaskFromTextDetail {
  /** Message text to seed the task description with. */
  text: string;
  /** The source session's working directory, when known. */
  projectRoot: string | null;
}

let pendingDraft: CreateTaskFromTextDetail | null = null;

/** Park a draft and nudge a mounted board (the caller switches to it). */
export function requestCreateTaskFromText(detail: CreateTaskFromTextDetail): void {
  pendingDraft = detail;
  window.dispatchEvent(new CustomEvent(CREATE_TASK_FROM_TEXT_EVENT));
}

/** One-shot consume — called by the board on mount and on the event. */
export function consumePendingTaskDraft(): CreateTaskFromTextDetail | null {
  const draft = pendingDraft;
  pendingDraft = null;
  return draft;
}
