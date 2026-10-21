"use client";

import { createElement, type ComponentType, type FunctionComponent } from "react";

import { useSlot, useSlotKit } from "./UiKitProvider";
import type {
  ButtonSlotProps,
  FieldSlotProps,
  SegmentedSlotProps,
  StatusSlotProps,
  ToggleSlotProps,
} from "./types";

/**
 * The five atoms so a caller never has to read the kit: each one resolves its
 * slot and renders the winning implementation. When a slot has no
 * implementation yet (a wave still owes it) the wrapper renders nothing rather
 * than crashing — the coverage test is what keeps that window short.
 *
 * The implementation is invoked through `createElement` rather than JSX on
 * purpose: `<Impl {...props} />` reads as "a component created during render"
 * to `react-hooks/static-components`, while createElement makes it explicit
 * that the component *identity* comes from the registry, not from this render.
 */

/**
 * Every registry entry is a plain function component, so narrowing is safe and
 * keeps `createElement` on its `FunctionComponent` overload — the class-component
 * branch would widen the props to `{}`.
 */
function usePrimitive<P extends object>(slot: Parameters<typeof useSlot>[0]): FunctionComponent<P> | null {
  return useSlot(slot) as FunctionComponent<P> | null;
}

function renderPrimitive<P extends object>(Impl: FunctionComponent<P> | null, props: P) {
  return Impl ? createElement(Impl, props) : null;
}

export const Button: ComponentType<ButtonSlotProps> = (props) =>
  renderPrimitive(usePrimitive<ButtonSlotProps>("button"), props);

export const Segmented: ComponentType<SegmentedSlotProps> = (props) =>
  renderPrimitive(usePrimitive<SegmentedSlotProps>("segmented"), props);

export const Toggle: ComponentType<ToggleSlotProps> = (props) =>
  renderPrimitive(usePrimitive<ToggleSlotProps>("toggle"), props);

export const Status: ComponentType<StatusSlotProps> = (props) =>
  renderPrimitive(usePrimitive<StatusSlotProps>("status"), props);

export const Field: ComponentType<FieldSlotProps> = (props) =>
  renderPrimitive(usePrimitive<FieldSlotProps>("field"), props);

/** Exported for tests that need the resolved kit without rendering. */
export { useSlotKit };