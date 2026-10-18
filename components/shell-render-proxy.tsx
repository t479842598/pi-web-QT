"use client";

import type { ComponentProps, ComponentType, ReactNode } from "react";

import { useSlot } from "@/components/ui-kit";

import { AppTitleBar } from "@/components/AppTitleBar";
import { SessionSidebar } from "@/components/SessionSidebar";
import { TabBar } from "@/components/TabBar";
import { ChatInput } from "@/components/ChatInput";
import { ModelSelector } from "@/components/ModelSelector";
import { FileViewer } from "@/components/FileViewer";
import { CompactionSummary } from "@/components/CompactionSummary";
import { CommandPalette } from "@/components/CommandPalette";
import { ApprovalModal } from "@/components/ApprovalModal";
import { PlanReviewDialog } from "@/components/PlanReviewDialog";
import { ProjectTrustDialog } from "@/components/ProjectTrustDialog";
import { QueueRecoveryDialog } from "@/components/QueueRecoveryDialog";
import { ImagePreview } from "@/components/ImagePreview";
import { ConfigPanelShell } from "@/components/SettingsUi";

/**
 * Shell and overlay render proxies.
 *
 * Same contract as `conversation-render-proxy`: the owning component keeps every
 * behaviour (drag regions, the session tree, dialog state machines) and this
 * layer only answers "which implementation draws it". The pi component is the
 * fallback, so `kit === "pi"` renders the shipping app unchanged.
 *
 * Kept in its own module so AppShell and ChatWindow each pull only the graphs
 * they need.
 */

/**
 * Marks the subtree as a Claude surface.
 *
 * The Claude stylesheet used to be gated on `html[data-ui-kit="claude"]`. That
 * holds only while the *global* kit is Claude — but the settings panel offers
 * per-scope and per-slot overrides, so a Claude component can render while the
 * html switch is still "pi". When that happened the component had its classes
 * and no rules at all: an unstyled title bar stacked vertically, a sidebar
 * collapsed to its own padding.
 *
 * `display: contents` generates no box, so the marker cannot change layout; it
 * only gives the descendant selectors a subtree to match.
 */
function ClaudeSurface({ children }: { children: ReactNode }) {
  return (
    <div className="claude-surface-root" style={{ display: "contents" }}>
      {children}
    </div>
  );
}

function makeProxy<P extends object>(slot: Parameters<typeof useSlot>[0], Pi: ComponentType<P>): ComponentType<P> {
  function SlotProxy(props: P) {
    const Impl = useSlot(slot) as ComponentType<P> | null;
    const Component = Impl ?? Pi;
    // Only wrap when the winning implementation is not the pi one; the pi tree
    // must stay byte-identical, so it keeps rendering exactly as before.
    if (!Impl || Impl === Pi) return <Component {...props} />;
    return (
      <ClaudeSurface>
        <Component {...props} />
      </ClaudeSurface>
    );
  }
  SlotProxy.displayName = `SlotProxy(${slot})`;
  return SlotProxy;
}

export const ShellTitleBar = makeProxy("titleBar", AppTitleBar);
export const ShellSidebar = makeProxy("sidebar", SessionSidebar);
export const ShellTabBar = makeProxy("tabBar", TabBar);
// No `ShellComposer`: the composer slot's Claude side is a frame that takes
// ReactNode slots ChatInput does not provide, so there is no drop-in proxy for
// it. The composer is restyled by app/settings-claude.css instead. Removing the
// export (rather than leaving it unrendered) is what keeps the wiring test
// meaningful — it asserts every export here is mounted somewhere.
export const ShellModelSwitcher = makeProxy("modelSwitcher", ModelSelector);
export const ShellFileViewer = makeProxy("fileViewer", FileViewer);
export const ConversationCompaction = makeProxy("compaction", CompactionSummary);

export const OverlayDialogShell = makeProxy("dialogShell", ConfigPanelShell);
export const OverlayPalette = makeProxy("palette", CommandPalette);
export const OverlayApproval = makeProxy("approvalCard", ApprovalModal);
export const OverlayPlanReview = makeProxy("planReview", PlanReviewDialog);
export const OverlayTrust = makeProxy("trustDialog", ProjectTrustDialog);
export const OverlayQueueRecovery = makeProxy("queueRecovery", QueueRecoveryDialog);
export const OverlayImageLightbox = makeProxy("imageLightbox", ImagePreview);

export type { ComponentProps };
