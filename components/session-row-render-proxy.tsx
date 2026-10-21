"use client";

import type { ComponentType, ReactNode } from "react";

import { useSlot } from "@/components/ui-kit";
import { PiSessionRow } from "@/components/ui-kit/pi/SessionRow";
import type { SessionRowSlotProps } from "@/components/ui-kit/types";

/**
 * Session-row render proxy.
 *
 * Same contract as `conversation-render-proxy` / `shell-render-proxy`: the
 * sidebar keeps owning the row's behaviour (selection, rename, archive
 * confirmation, hover actions, the fork tooltip that anchors to the row's
 * rect), and this layer only answers "which component draws the box".
 *
 * The pi implementation is the fallback AND the shipping implementation, so
 * while `kit === "pi"` the row renders exactly the inline markup it rendered
 * before the slot existed. The Claude wrapper node is only emitted for a
 * non-pi implementation: `claude-surface-root` is what lets a per-slot
 * override style the row when the global kit switch still says "pi" (see the
 * note on `ClaudeSurface` in shell-render-proxy.tsx).
 *
 * `display: contents` generates no box, so the marker cannot move anything.
 */
export function SessionRowShell(props: SessionRowSlotProps): ReactNode {
  const Impl = useSlot("sessionRow") as ComponentType<SessionRowSlotProps> | null;
  if (!Impl || Impl === PiSessionRow) return <PiSessionRow {...props} />;
  return (
    <div className="claude-surface-root" style={{ display: "contents" }}>
      <Impl {...props} />
    </div>
  );
}
