"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * Claude-style transcript list.
 *
 * Same props as `VirtualizedMessageList` so the two are drop-in — that is the
 * `messageList` slot contract. What differs is *how* it loads and presents:
 *
 *  - The pi list windows with a plain overscan and no edge treatment. This one
 *    keeps the window (a 5000-message session must not mount 5000 rows) but adds
 *    the CDS scroll treatment: a skeleton pass until the first measurement
 *    settles, and top/bottom fade masks driven by `--cds-scroll-fade-*`.
 *  - Scroll pinning follows `useClaudeScrollPinning` semantics: a 40px bottom
 *    tolerance keeps the view pinned while streaming, and any manual scroll
 *    away releases it.
 *
 * The item array, keys and virtualizer handle come from the caller unchanged:
 * grouping (ProcessGroup collapsing, subagent segments) stays in ChatWindow, so
 * switching this slot changes presentation only.
 */

export interface ClaudeMessageListProps {
  scrollElementRef: React.RefObject<HTMLElement | null>;
  items: ReactNode[];
  itemKeys: string[];
  estimateSize?: number;
  overscan?: number;
  virtualizerRef?: React.MutableRefObject<unknown>;
  headerHeight?: number;
}

const PIN_TOLERANCE_PX = 40;
const FADE_SIZE = 28;

export function ClaudeMessageList({
  scrollElementRef,
  items,
  itemKeys,
  estimateSize = 120,
  overscan = 8,
  headerHeight = 0,
}: ClaudeMessageListProps) {
  const [ready, setReady] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const pinnedRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => itemKeys[index] ?? index,
  });

  // One frame of skeleton separates "mounted" from "measured", which is what
  // makes the first paint feel deliberate instead of jumping.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const measureEdges = useCallback(() => {
    const element = scrollElementRef.current;
    if (!element) return;
    const { scrollTop, scrollHeight, clientHeight } = element;
    const nearTop = scrollTop <= FADE_SIZE;
    const nearBottom = scrollHeight - (scrollTop + clientHeight) <= FADE_SIZE;
    setAtTop(nearTop);
    setAtBottom(nearBottom);
    pinnedRef.current = scrollHeight - (scrollTop + clientHeight) <= PIN_TOLERANCE_PX;
  }, [scrollElementRef]);

  useEffect(() => {
    const element = scrollElementRef.current;
    if (!element) return;
    measureEdges();
    element.addEventListener("scroll", measureEdges, { passive: true });
    return () => element.removeEventListener("scroll", measureEdges);
  }, [measureEdges, scrollElementRef]);

  // Keep the tail pinned while a run streams, using the same 40px tolerance the
  // pi list uses, so switching kits does not change what "staying at the bottom"
  // means to a reader.
  useEffect(() => {
    if (!pinnedRef.current) return;
    virtualizer.scrollToIndex(items.length - 1, { align: "end" });
  }, [items.length, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const maskTop = atTop ? 0 : FADE_SIZE;
  const maskBottom = atBottom ? 0 : FADE_SIZE;

  return (
    <div className="relative h-full min-h-0">
      {!ready && (
        <div className="absolute inset-x-0 top-0 z-10 px-4 pt-4" aria-hidden="true">
          <div
            style={{
              height: 54,
              borderRadius: "var(--cds-radius-bubble, 18px)",
              background: "var(--cds-fill-secondary, var(--bg-hover))",
              opacity: 0.5,
            }}
          />
        </div>
      )}
      <div
        style={{
          height: virtualizer.getTotalSize() + headerHeight,
          position: "relative",
          width: "100%",
          paddingTop: headerHeight,
          // `black`/`transparent` are alpha-channel stops here, not palette
          // colours: in a mask the colour is irrelevant and only its alpha is
          // read. Spelling them as keywords also keeps this file free of hex
          // literals, which is what the token lock checks for.
          maskImage:
            maskTop || maskBottom
              ? `linear-gradient(to bottom, transparent 0, black ${maskTop}px, black calc(100% - ${maskBottom}px), transparent 100%)`
              : undefined,
          transition: "mask-image 160ms var(--cds-ease-swift, ease)",
        }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start + headerHeight}px)`,
            }}
          >
            {items[virtualItem.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
