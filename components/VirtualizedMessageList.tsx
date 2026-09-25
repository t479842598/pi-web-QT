"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { measureCommittedMessageRows, measureMessageRow } from "@/lib/virtualized-message-layout";

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
  itemKeys,
  estimateSize = 120,
  overscan = 8,
  virtualizerRef,
  headerHeight = 0,
}: {
  scrollElementRef: RefObject<HTMLElement | null>;
  items: ReactNode[];
  /** Stable identity per item (entryId / structural id), parallel to `items`
   * and produced by the SAME render that produced `items` — so a row's key
   * always matches its committed data-index. Never resolve keys through refs
   * or mutable state here: a concurrent/interrupted render would publish keys
   * for rows that were never committed, and the measurement cache would then
   * store one row's height under another row's key (overlapping text). */
  itemKeys: string[];
  estimateSize?: number;
  overscan?: number;
  /** Receives the virtualizer instance (for minimap layout queries). */
  virtualizerRef?: MutableRefObject<Virtualizer<HTMLElement, Element> | null>;
  /** Height (px) of siblings rendered ABOVE the list inside the same scroll
   * container (ExtensionStatusBar / ExtensionWidgets). The virtualizer maps
   * item offsets to scrollTop as if the list started at 0, so any non-zero
   * header shifts every row by that amount unless it is passed as scrollMargin. */
  headerHeight?: number;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const committedKeysRef = useRef(itemKeys);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  // The parent's host ref attaches after this child's layout effects on mount.
  useEffect(() => {
    setScrollElement(scrollElementRef.current);
  }, [scrollElementRef]);

  // TanStack Virtual's API returns non-memoizable functions; React Compiler
  // would skip this component anyway. Keep it a leaf: stable props in, rows
  // out, and route virtualizer queries through the ref for consumers.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLElement, Element>({
    count: items.length,
    getScrollElement: () => scrollElement ?? scrollElementRef.current,
    estimateSize: useCallback(() => estimateSize, [estimateSize]),
    overscan,
    getItemKey: useCallback((index: number) => itemKeys[index] ?? `idx-${index}`, [itemKeys]),
    scrollMargin: headerHeight,
    measureElement: (node, _entry, instance) => {
      const index = instance.indexFromElement(node);
      const key = node.getAttribute("data-item-key");
      const expectedKey = instance.options.getItemKey(index);
      const list = listRef.current;
      if (!list || !node.isConnected || node.parentElement !== list || key !== expectedKey
        || key !== committedKeysRef.current[index] || !list.getClientRects().length) {
        return instance.itemSizeCache.get(expectedKey) ?? estimateSize;
      }
      return measureMessageRow(node);
    },
  });

  // Scroll-position adjustments on item size change: the virtualizer
  // compensates scrollTop by the estimate→measured delta of rows above the
  // fold so the anchored content stays put. That compensation is only
  // correct while the user is NOT scrolling — during a scroll-up gesture it
  // fights the user (every newly measured short row drags the viewport back
  // toward the bottom, and the total-size shrink then clamps scrollTop to
  // the new max: the “scroll up → bounce back to bottom” loop).
  //
  // We disable it ENTIRELY (always false), not just during gestures:
  // measurements keep landing AFTER the gesture ends (rows mount and
  // ResizeObserver reports while isScrolling is already false), and the
  // delayed compensation then shifts scrollTop by the accumulated
  // estimate→measured delta — positive deltas (tall rows measuring from the
  // 60px estimate) drag the viewport straight back toward the bottom the
  // moment the user stops scrolling. scrollTop must be owned exclusively by
  // the user (wheel/touch) and by useAgentSession's scrollToBottom; the
  // virtualizer never adjusts it on its own.
  // In tanstack-virtual 3.17.7 this is a Virtualizer INSTANCE field: passing
  // it as an option merges it into `options`, but resizeItem reads the
  // instance field, so an option never takes effect. Assign it directly;
  // setOptions does not overwrite the instance field.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;

  if (virtualizerRef) virtualizerRef.current = virtualizer;

  // Keep offscreen measurements: clearing the cache shrinks the scroll range
  // to estimates and can clamp the user's reading position to the bottom.
  const measureMountedRows = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const measurements = measureCommittedMessageRows(list, committedKeysRef.current);
    for (const { index, size } of measurements) {
      if (virtualizer.options.getItemKey(index) === committedKeysRef.current[index]) {
        virtualizer.resizeItem(index, size);
      }
    }
  }, [virtualizer]);

  useLayoutEffect(() => {
    committedKeysRef.current = itemKeys;
    measureMountedRows();
  }, [itemKeys, items, measureMountedRows]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // ResizeObserver can pause in background tabs. Local expand/collapse and
    // streaming DOM edits still need to update offsets before the next paint.
    const observer = new MutationObserver((records) => {
      const contentChanged = records.some((record) => record.type !== "attributes"
        || (record.target !== list && record.target.parentNode !== list));
      if (contentChanged) measureMountedRows();
    });
    observer.observe(list, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "src", "width", "height"],
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") measureMountedRows();
    };
    document.addEventListener("visibilitychange", onVisible);
    list.addEventListener("load", measureMountedRows, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      list.removeEventListener("load", measureMountedRows, true);
    };
  }, [measureMountedRows]);

  // The chat opens at the bottom; position the viewport at the newest items
  // right after first paint so scrolling down shows the tail, not the top.
  // (useAgentSession also calls scrollToBottom once messages load; this guards
  // the very first paint before that effect runs.) scrollToIndex follows the
  // row measurements as they refine, unlike a raw scrollTop on the estimate.
  // initialScrollDoneRef prevents later content updates from pulling a reader
  // back to the tail. The virtualizer instance itself is stable across renders.
  const initialScrollDoneRef = useRef(false);
  const virtualizerRefStable = useRef(virtualizer);
  virtualizerRefStable.current = virtualizer;
  useEffect(() => {
    if (initialScrollDoneRef.current || items.length === 0) return;
    if (!scrollElement) return;
    initialScrollDoneRef.current = true;
    virtualizerRefStable.current.scrollToIndex(items.length - 1, { align: "end" });
  }, [items.length, scrollElement]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      className="virtualized-message-list"
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
          data-item-key={item.key}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            minWidth: 0,
            // clip, not hidden: both clip the row's content, but `hidden` makes
            // this row a scroll container, which traps `position: sticky`
            // descendants (the message copy cluster) in a box that never
            // scrolls, hiding them on long turns.
            overflow: "clip",
            transform: `translateY(${item.start - headerHeight}px)`,
          }}
        >
          {items[item.index]}
        </div>
      ))}
    </div>
  );
}