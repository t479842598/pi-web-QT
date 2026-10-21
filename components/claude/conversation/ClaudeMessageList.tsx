"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";

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
  /** Receives the virtualizer instance (for minimap layout queries). Same
   * contract as `VirtualizedMessageList`: the slot is only a slot if both
   * sides answer the same questions, and ChatWindow's minimap adapter reads
   * offsets, sizes and the total height out of this ref. */
  virtualizerRef?: MutableRefObject<Virtualizer<HTMLElement, Element> | null>;
  headerHeight?: number;
}

const PIN_TOLERANCE_PX = 40;
const FADE_SIZE = 28;

/**
 * Publish `virtualizer` into the caller's ref and return the undo step.
 *
 * Split out of the effect (and exported) because the effect body is this one
 * call, so a test can exercise the mount/unmount semantics without a DOM.
 *
 * - Idempotent: `useVirtualizer` keeps ONE instance per mounted component, so
 *   re-running the publish writes the same value. React 19 StrictMode tears
 *   effects down and rebuilds them on mount; a render-phase write (what the pi
 *   list does) has nothing to re-run after that simulated unmount, so the
 *   publish lives in the effect and survives the double invoke.
 * - The undo only clears the slot while it still holds THIS instance. On a kit
 *   switch the incoming list publishes before the outgoing one unmounts, and an
 *   unconditional null would hand the minimap a dead ref — worse than the stale
 *   one it replaces, because layout queries then read as a zero-height list.
 */
export function publishVirtualizer(
  target: MutableRefObject<Virtualizer<HTMLElement, Element> | null> | undefined,
  virtualizer: Virtualizer<HTMLElement, Element>,
): () => void {
  if (!target) return () => {};
  target.current = virtualizer;
  return () => {
    if (target.current === virtualizer) target.current = null;
  };
}

export function ClaudeMessageList({
  scrollElementRef,
  items,
  itemKeys,
  estimateSize = 120,
  overscan = 8,
  virtualizerRef,
  headerHeight = 0,
}: ClaudeMessageListProps) {
  const [ready, setReady] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const pinnedRef = useRef(true);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => itemKeys[index] ?? index,
    // The header is a preceding SIBLING inside the scroll container
    // (components/ChatWindow.tsx:893), so item offsets must be expressed in
    // scroll-container coordinates. scrollMargin is the mechanism: virtual-core
    // starts the first item at paddingStart + scrollMargin
    // (node_modules/@tanstack/virtual-core/dist/esm/index.js:627) and subtracts
    // it again in getTotalSize() (:1082). Same contract as the pi list
    // (components/VirtualizedMessageList.tsx:70).
    scrollMargin: headerHeight,
  });

  // The virtualizer's own scroll compensation is wrong here, for the same reason
  // the pi list disables it (components/VirtualizedMessageList.tsx:86-105): it is
  // only correct while nobody is scrolling. Measurements keep landing after the
  // gesture ends — rows mount and ResizeObserver reports once isScrolling is
  // already false — and the delayed compensation then drags scrollTop by the
  // accumulated estimate-to-measured delta, pulling the reader back toward the
  // bottom the moment they stop scrolling. scrollTop belongs to the user's
  // wheel/touch and to the streaming tail-pin below, never to the virtualizer.
  // In tanstack-virtual 3.17.7 this is an INSTANCE field: passing it as an option
  // merges into options, but resizeItem reads the instance field, so an option
  // never takes effect. setOptions does not overwrite it.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;

  // Hand the instance to the caller. Without this the prop is destructured away,
  // ChatWindow's `messageVirtualizerRef` stays null, its minimap adapter answers
  // 0 for every layout query, and ChatMinimap bails at `totalHeight() <= 0` —
  // i.e. switching to this kit silently switches off the navigation landmarks.
  //
  // A layout effect, so the ref is published during the commit rather than
  // after paint: the minimap is a sibling mounted after this list, and its
  // `totalHeight() <= 0` guard must never see an unpublished ref. The pi list
  // has no such gap because it writes the ref during render; an effect is the
  // StrictMode-safe way to get the same guarantee (a render-phase write has
  // nothing to re-run after the simulated unmount, and no cleanup to drop the
  // instance). `useVirtualizer` keeps one instance per mounted component, so
  // re-running the publish is idempotent and the cleanup is what guarantees the
  // caller never keeps THIS instance after the list is gone.
  useLayoutEffect(() => publishVirtualizer(virtualizerRef, virtualizer), [virtualizerRef, virtualizer]);

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
          // getTotalSize() already excludes scrollMargin (virtual-core:1082),
          // so this box spans exactly the item range — no second headerHeight.
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
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
              // start is in scroll-container coordinates (it carries
              // scrollMargin); this box starts headerHeight lower, so the row
              // is placed at start - headerHeight. Same as the pi list
              // (components/VirtualizedMessageList.tsx:203).
              transform: `translateY(${virtualItem.start - headerHeight}px)`,
            }}
          >
            {items[virtualItem.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
