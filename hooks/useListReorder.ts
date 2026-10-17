/**
 * Reordering a list by drag, by arrow button or by keyboard.
 *
 * WHY the index math lives in this file as a pure function: the move has to be
 * exact. `placement` describes where the row lands *relative to the target row
 * as the user still sees it*, so removing the source first shifts every later
 * index down by one. That off-by-one is invisible in a manual test of a two-row
 * list and obvious in a five-row one, which is why `reorderItem` is exported.
 */

import { useCallback, useRef, useState } from "react";

export type ReorderPlacement = "above" | "below";

function inRange(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

/**
 * Moves the item at `source` to `placement` of the item at `target`.
 *
 * Implementation order matters: the source is removed first, and the insertion
 * index is computed against the *shortened* array. `placement === "below"` then
 * means `target + 1`, but when the source sat before the target that removal
 * already shifted the target left by one, so the insert index loses one again —
 * `source < target ? target : target + 1` on the shortened array. Getting this
 * wrong moves a row one slot too far, which the tests pin case by case.
 */
export function reorderItem<T>(
  list: readonly T[],
  source: number,
  target: number,
  placement: ReorderPlacement,
): T[] {
  const copy = [...list];
  if (!inRange(source, copy.length) || !inRange(target, copy.length) || source === target) return copy;

  const [moved] = copy.splice(source, 1);
  const insertAt = source < target ? (placement === "above" ? target - 1 : target) : (placement === "above" ? target : target + 1);
  copy.splice(insertAt, 0, moved);
  return copy;
}

export interface ListReorderOptions {
  length: number;
  busy?: boolean;
  onMove: (from: number, to: number) => void;
}

export interface DragItemProps {
  draggable: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragLeave: () => void;
}

export interface ReorderKeyboardProps {
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  tabIndex: number;
}

export interface ListReorderController {
  draggingIndex: number | null;
  overIndex: number | null;
  itemProps: (index: number) => DragItemProps;
  moveBy: (index: number, delta: -1 | 1) => void;
  keyboardProps: (index: number) => ReorderKeyboardProps;
}

/** Placement of a drop, from the pointer's position inside the row it is over. */
function placementFor(element: HTMLElement, clientY: number): ReorderPlacement {
  const rect = element.getBoundingClientRect();
  if (rect.height <= 0) return "below";
  return clientY < rect.top + rect.height / 2 ? "above" : "below";
}

/**
 * Drag-and-drop plus explicit `moveBy` for lists whose order is persisted.
 * WHY `busy` disables dragging instead of hiding the handle: a save in flight
 * would otherwise let a second reorder land on a list that is being written.
 */
export function useListReorder({ length, busy = false, onMove }: ListReorderOptions): ListReorderController {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const placementRef = useRef<ReorderPlacement>("below");

  const moveBy = useCallback((index: number, delta: -1 | 1) => {
    if (!inRange(index, length)) return;
    const next = index + delta;
    if (next < 0 || next >= length) return;
    onMove(index, next);
  }, [length, onMove]);

  const itemProps = useCallback((index: number): DragItemProps => ({
    draggable: !busy && inRange(index, length),
    onDragStart: (event) => {
      if (busy) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      // Firefox refuses to start a drag without any payload.
      event.dataTransfer.setData("text/plain", String(index));
      setDraggingIndex(index);
    },
    onDragOver: (event) => {
      if (busy || draggingIndex === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      placementRef.current = placementFor(event.currentTarget, event.clientY);
      if (overIndex !== index) setOverIndex(index);
    },
    onDrop: (event) => {
      event.preventDefault();
      const from = draggingIndex;
      setDraggingIndex(null);
      setOverIndex(null);
      if (busy || from === null || from === index) return;
      const next = reorderItem(Array.from({ length }, (_, i) => i), from, index, placementRef.current);
      const to = next.indexOf(from);
      if (to === -1 || to === from) return;
      onMove(from, to);
    },
    onDragEnd: () => {
      setDraggingIndex(null);
      setOverIndex(null);
    },
    onDragLeave: () => {
      if (overIndex === index) setOverIndex(null);
    },
  }), [busy, draggingIndex, length, onMove, overIndex]);

  const keyboardProps = useCallback((index: number): ReorderKeyboardProps => ({
    tabIndex: busy ? -1 : 0,
    onKeyDown: (event) => {
      if (busy) return;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveBy(index, -1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveBy(index, 1);
      }
    },
  }), [busy, moveBy]);

  return { draggingIndex, overIndex, itemProps, moveBy, keyboardProps };
}
