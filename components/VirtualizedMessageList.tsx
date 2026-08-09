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
  estimateSize = 130,
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

  // Scroll-position adjustments on item size change: the virtualizer
  // compensates scrollTop by the estimate→measured delta of rows above the
  // fold so the anchored content stays put. That compensation is only
  // correct while the user is NOT scrolling — during a scroll-up gesture it
  // fights the user (every newly measured short row drags the viewport back
  // toward the bottom, and the total-size shrink then clamps scrollTop to
  // the new max: the “scroll up → bounce back to bottom” loop). So:
  //   • while a scroll gesture is in flight (wheel/touch/programmatic) →
  //     never adjust (no fighting, no cascade);
  //   • while stationary → adjust only rows ENTIRELY above the fold
  //     (keeps the anchored content in place and prevents the shrink
  //     clamp); rows spanning the fold (a streaming message growing at its
  //     bottom) are left alone — adjusting them would drag the viewport
  //     downward on every growth (#1218).
  // In tanstack-virtual 3.17.7 this is a Virtualizer INSTANCE field: passing
  // it as an option merges it into `options`, but resizeItem reads the
  // instance field, so an option never takes effect. Assign it directly;
  // setOptions does not overwrite the instance field.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    if (instance.isScrolling) return false;
    const offset = instance.scrollOffset ?? 0;
    return item.start + item.size <= offset;
  };

  if (virtualizerRef) virtualizerRef.current = virtualizer;

  // NOTE: do NOT call virtualizer.measure() here. It clears the item size
  // cache, dropping every measured row back to the estimate; mounted rows
  // whose DOM size has not changed are never re-reported by ResizeObserver,
  // so their real sizes stay lost. The total height then shrinks to
  // count×estimate while the user is reading (or streaming), the browser
  // clamps scrollTop to the new max, and the viewport bounces to the
  // bottom. Newly mounted rows measure themselves via measureElement /
  // ResizeObserver — nothing needs to be forced here.

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