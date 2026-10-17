/**
 * Public entry point of the two-kit UI layer.
 *
 * Call sites should import from here, never from `./registry` or `./claude/*`
 * directly: this module is the only place that knows how a slot resolves, and
 * keeping it that way is what makes `kit === "pi"` provably identical to the
 * pre-refactor UI.
 */

export {
  KitScope,
  useSlot,
  useSlotKit,
  useUiKit,
  surfaceProps,
  type UiKitApi,
} from "./UiKitProvider";

export { slotComponent, UI_KIT_REGISTRY, CLAUDE_PENDING, PI_PENDING, type SlotRegistryEntry } from "./registry";

export type {
  ButtonSlotProps,
  FieldSlotProps,
  ScrollFadeSlotProps,
  SegmentedItem,
  SegmentedSlotProps,
  SessionRowSlotProps,
  SlotPropsMap,
  StatusSlotProps,
  StatusTone,
  ToggleSlotProps,
} from "./types";

// Typed convenience wrappers for the primitives. Heavy slots are rendered via
// `useSlot(slot)` because their props come from the pi component itself.
export { Button, Field, ScrollFade, Segmented, Status, Toggle } from "./primitives";
