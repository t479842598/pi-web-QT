/**
 * Slot → implementation table.
 *
 * The pi column holds the components that ship today, referenced in place: the
 * pi tree is never moved or rewritten, so `kit === "pi"` is by construction the
 * current UI. The claude column is filled wave by wave; `CLAUDE_PENDING`
 * records which wave is allowed to leave a slot unimplemented, and the coverage
 * test fails if a slot is neither implemented nor listed.
 *
 * The primitives are bound in both columns (W1): the pi adapters in
 * `./pi/` reproduce today's markup, the CDS ones live in
 * `@/components/claude/primitives`. `sessionRow` still needs a pi adapter —
 * the row is inline markup in `SessionSidebar` today, not a component.
 */

import type { ComponentType } from "react";

import { AppTitleBar } from "@/components/AppTitleBar";
import { SessionSidebar } from "@/components/SessionSidebar";
import { TabBar } from "@/components/TabBar";
import { ChatInput } from "@/components/ChatInput";
import { ModelSelector } from "@/components/ModelSelector";
import { FileViewer } from "@/components/FileViewer";
import { VirtualizedMessageList } from "@/components/VirtualizedMessageList";
import { MessageView, ThinkingBlock } from "@/components/MessageView";
import { ProcessGroup } from "@/components/ProcessGroup";
import { SubagentRunRow } from "@/components/SubagentRunRow";
import { AgentSessionPanel } from "@/components/AgentSessionPanel";
import { CompactionSummary } from "@/components/CompactionSummary";
import { ConfigPanelShell } from "@/components/SettingsUi";
import { ApprovalModal } from "@/components/ApprovalModal";
import { PlanReviewDialog } from "@/components/PlanReviewDialog";
import { ProjectTrustDialog } from "@/components/ProjectTrustDialog";
import { QueueRecoveryDialog } from "@/components/QueueRecoveryDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { ImagePreview } from "@/components/ImagePreview";
import { ClaudeMessageList } from "@/components/claude/conversation/ClaudeMessageList";
import { ClaudeMessageShell } from "@/components/claude/conversation/ClaudeMessageShell";
import { ClaudeThinking } from "@/components/claude/conversation/ClaudeThinking";
import { ClaudeToolCard } from "@/components/claude/conversation/ClaudeToolCard";
import { ClaudeSubagentRow } from "@/components/claude/conversation/ClaudeSubagentRow";
import { ClaudeSubagentPanel } from "@/components/claude/conversation/ClaudeSubagentPanel";
import { ClaudeCompactionSummary } from "@/components/claude/conversation/ClaudeCompactionSummary";
import { ClaudeDialogShell } from "@/components/claude/overlay/ClaudeDialogShell";
import { ClaudeApprovalCard } from "@/components/claude/overlay/ClaudeApprovalCard";
import { ClaudePlanReview } from "@/components/claude/overlay/ClaudePlanReview";
import { ClaudeTrustDialog } from "@/components/claude/overlay/ClaudeTrustDialog";
import { ClaudeQueueRecovery } from "@/components/claude/overlay/ClaudeQueueRecovery";
import { ClaudePalette } from "@/components/claude/overlay/ClaudePalette";
import { ClaudeImageLightbox } from "@/components/claude/overlay/ClaudeImageLightbox";
import { ClaudeTitleBar } from "@/components/claude/shell/ClaudeTitleBar";
import { ClaudeSidebar } from "@/components/claude/shell/ClaudeSidebar";
import { ClaudeSessionRow } from "@/components/claude/shell/ClaudeSessionRow";
import { PiSessionRow } from "@/components/ui-kit/pi/SessionRow";
import { ClaudeTabBar } from "@/components/claude/shell/ClaudeTabBar";
import { ClaudeComposerChrome } from "@/components/claude/shell/ClaudeComposerChrome";
import { ClaudeModelSwitcher } from "@/components/claude/shell/ClaudeModelSwitcher";
import { ClaudeFileViewer } from "@/components/claude/shell/ClaudeFileViewer";

import { PiButton } from "@/components/ui-kit/pi/Button";
import { PiSegmented } from "@/components/ui-kit/pi/Segmented";
import { PiToggle } from "@/components/ui-kit/pi/Toggle";
import { PiStatus } from "@/components/ui-kit/pi/Status";
import { PiField } from "@/components/ui-kit/pi/Field";
import { PiScrollFade } from "@/components/ui-kit/pi/ScrollFade";

import { CdsButton } from "@/components/claude/primitives/CdsButton";
import { CdsSegmented } from "@/components/claude/primitives/SegmentedControl";
import { CdsToggle } from "@/components/claude/primitives/CdsToggle";
import { CdsStatus } from "@/components/claude/primitives/StatusIndicators";
import { CdsField } from "@/components/claude/primitives/CdsField";
import { CdsScrollFade } from "@/components/claude/primitives/ScrollFadeContainer";

import type { KitId, SlotId } from "@/lib/ui-kit";
import type { SlotPropsMap } from "./types";

/** Untyped handle; `useSlot` restores the slot's own prop type at the call site. */
export type AnySlotComponent = ComponentType<never>;

export interface SlotRegistryEntry {
  pi: AnySlotComponent | null;
  claude: AnySlotComponent | null;
}

/** `SLOT_IDS` order is preserved so the settings panel and tests agree. */
export const UI_KIT_REGISTRY: Record<SlotId, SlotRegistryEntry> = {
  button: { pi: PiButton, claude: CdsButton },
  segmented: { pi: PiSegmented, claude: CdsSegmented },
  toggle: { pi: PiToggle, claude: CdsToggle },
  status: { pi: PiStatus, claude: CdsStatus },
  field: { pi: PiField, claude: CdsField },
  scrollFade: { pi: PiScrollFade, claude: CdsScrollFade },

  dialogShell: { pi: ConfigPanelShell, claude: ClaudeDialogShell },
  approvalCard: { pi: ApprovalModal, claude: ClaudeApprovalCard },
  planReview: { pi: PlanReviewDialog, claude: ClaudePlanReview },
  trustDialog: { pi: ProjectTrustDialog, claude: ClaudeTrustDialog },
  queueRecovery: { pi: QueueRecoveryDialog, claude: ClaudeQueueRecovery },
  palette: { pi: CommandPalette, claude: ClaudePalette },
  imageLightbox: { pi: ImagePreview, claude: ClaudeImageLightbox },

  titleBar: { pi: AppTitleBar, claude: ClaudeTitleBar },
  sidebar: { pi: SessionSidebar, claude: ClaudeSidebar },
  sessionRow: { pi: PiSessionRow, claude: ClaudeSessionRow },
  tabBar: { pi: TabBar, claude: ClaudeTabBar },
  composer: { pi: ChatInput, claude: ClaudeComposerChrome },
  modelSwitcher: { pi: ModelSelector, claude: ClaudeModelSwitcher },
  fileViewer: { pi: FileViewer, claude: ClaudeFileViewer },

  messageList: { pi: VirtualizedMessageList, claude: ClaudeMessageList },
  messageShell: { pi: MessageView, claude: ClaudeMessageShell },
  thinking: { pi: ThinkingBlock, claude: ClaudeThinking },
  toolCard: { pi: ProcessGroup, claude: ClaudeToolCard },
  subagentRow: { pi: SubagentRunRow, claude: ClaudeSubagentRow },
  subagentPanel: { pi: AgentSessionPanel, claude: ClaudeSubagentPanel },
  compaction: { pi: CompactionSummary, claude: ClaudeCompactionSummary },
};

/**
 * Slots whose pi adapter or Claude implementation is not written yet, keyed to
 * the wave that owes it. Must end up empty before release.
 */
export const CLAUDE_PENDING: Partial<Record<SlotId, string>> = {
  // overlay — wave 3
  // shell — wave 4
};

/** Slots that still need a pi adapter (inline markup today). */
export const PI_PENDING: readonly SlotId[] = [];

export function slotComponent<S extends SlotId>(slot: S, kit: KitId): ComponentType<SlotPropsMap[S]> | null {
  const entry = UI_KIT_REGISTRY[slot];
  const picked = kit === "claude" ? entry.claude ?? entry.pi : entry.pi;
  return (picked ?? null) as ComponentType<SlotPropsMap[S]> | null;
}
