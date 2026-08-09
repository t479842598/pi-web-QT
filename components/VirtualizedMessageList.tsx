"use client";

import { useCallback, useEffect, useRef, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";

/**
 * Virtualized renderer for the message list.
 *
 * T-004 (方案 B): the full `items` array is the data source and only the
 * viewport window (± overscan) is mounted as real DOM nodes, so very long
 * sessions scroll without the DOM growing with scroll depth. Each item is
 * absolutely positioned inside a `position:relative` wrapper whose height
 * equals the virtualizer's total size — scrollbar geometry stays exact.
 *
 * Item heights are dynamic: the virtualizer starts from `estimateSize` and
 * corrects with `measureElement` once a node mounts (works for ProcessGroups,
 * markdown messages and streamed tails alike). The scroll container is
 * managed by useAgentSession / ChatMinimap through the shared ref.
 *
 * The old pagination sentinel is gone: `items` is the full rendered array,
 * so scrolling to the top instantly reaches the oldest message.
 */
export function VirtualizedMessageList({
  scrollElementRef,
  items,
  estimateSize = 240,
  overscan = 8,
  virtualizerRef,
}: {
  scrollElementRef: RefObject<HTMLElement | null>;
  items: ReactNode[];
  estimateSize?: number;
  overscan?: number;
  /** Receives the virtualizer instance (for minimap layout queries). */
  virtualizerRef?: MutableRefObject<Virtualizer<HTMLElement, Element> | null>;
}) {
  // TanStack Virtual's API returns non-memoizable functions; React Compiler
  // would skip this component anyway. Keep it a leaf: stable props in, rows
  // out, and route virtualizer queries through the ref for consumers.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLElement, Element>({
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: useCallback(() => estimateSize, [estimateSize]),
    overscan,
    // Items only ever grow at the tail (streaming) or are fully replaced
    // (branch switch) — never reordered, so index keys are stable.
  });

  if (virtualizerRef) virtualizerRef.current = virtualizer;

  // Re-measure after the item count changes so newly mounted rows start from
  // their real size instead of the estimate (streaming tails, images, etc.).
  useEffect(() => {
    virtualizer.measure();
    // Direct call per render is fine; the effect key is the count itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // The chat opens at the bottom; position the viewport at the newest items
  // right after first paint so scrolling down shows the tail, not the top.
  // (useAgentSession also calls scrollToBottom once messages load; this guards
  // the very first paint before that effect runs.) scrollToIndex follows the
  // row measurements as they refine, unlike a raw scrollTop on the estimate.
  // NOTE: the effect intentionally does NOT list `virtualizer` as a dep —
  // tanstack creates a fresh object each render, so listing it would cause
  // this effect to fire on every render instead of only when items change.
  // initialScrollDoneRef prevents re-execution regardless of render count.
  const initialScrollDoneRef = useRef(false);
  const virtualizerRefStable = useRef(virtualizer);
  virtualizerRefStable.current = virtualizer;
  useEffect(() => {
    if (initialScrollDoneRef.current || items.length === 0) return;
    const el = scrollElementRef.current;
    if (!el) return;
    initialScrollDoneRef.current = true;
    virtualizerRefStable.current.scrollToIndex(items.length - 1, { align: "end" });
  }, [items.length, scrollElementRef]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        minWidth: 0,
        height: virtualizer.getTotalSize(),
      }}
    >
      {virtualItems.map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            minWidth: 0,
            transform: `translateY(${item.start}px)`,
          }}
        >
          {items[item.index]}
        </div>
      ))}
    </div>
  );
}