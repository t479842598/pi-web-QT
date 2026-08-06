"use client";

/**
 * Board-column helpers for the Tasks board. The status→column mapping and
 * grouping live in lib/task-types.ts (unit-tested); this file only adds the
 * UI-facing column metadata.
 */

import type { BoardColumnId } from "@/lib/task-types";

export const BOARD_COLUMN_IDS: BoardColumnId[] = [
  "todo",
  "inProgress",
  "attention",
  "done",
];

export interface ColumnMeta {
  id: BoardColumnId;
  /** Marker color (left bar) — same tones as codeg's board. */
  marker: string;
}

export const COLUMN_META: Record<BoardColumnId, ColumnMeta> = {
  todo: { id: "todo", marker: "var(--text-dim)" },
  inProgress: { id: "inProgress", marker: "var(--accent)" },
  attention: { id: "attention", marker: "#f59e0b" },
  done: { id: "done", marker: "#10b981" },
};

/** i18n key prefix for a column label (tasks.colTodo etc.). */
export function columnLabelKey(col: BoardColumnId): string {
  return `tasks.col${col[0].toUpperCase()}${col.slice(1)}`;
}

/** i18n key prefix for an empty-column hint. */
export function emptyLabelKey(col: BoardColumnId): string {
  return `tasks.emptyCol${col[0].toUpperCase()}${col.slice(1)}`;
}
