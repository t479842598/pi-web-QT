/**
 * Slot property contracts for the two-kit UI.
 *
 * A slot is a surface that can render as either kit. The contract is what the
 * call site passes; each kit's implementation receives exactly that shape.
 *
 * For heavyweight surfaces (transcript, composer, dialogs) the contract is
 * derived from the pi implementation that ships today via
 * `ComponentProps<typeof PiComponent>`. That is deliberate: the pi tree must
 * not be rewritten, so its props ARE the contract, and the Claude
 * implementation has to satisfy the same signature. Deriving instead of
 * re-declaring also means the two can never drift.
 *
 * The imports below are used in type positions only; TypeScript elides them
 * from the emitted bundle.
 */

import type { ButtonHTMLAttributes, ComponentProps, InputHTMLAttributes, ReactNode, Ref } from "react";

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

// ─── Primitives (hand-written: both kits implement these from scratch) ───────

export interface ButtonSlotProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger";
  size?: "xxs" | "xs" | "sm" | "md" | "lg" | "icon";
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  loading?: boolean;
  children?: ReactNode;
}

export interface SegmentedItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: string | number;
}

export interface SegmentedSlotProps {
  items: SegmentedItem[];
  value: string;
  onChange: (id: string) => void;
  size?: "sm" | "md";
  /** Accessible name for the group; required — the track has no visible label. */
  ariaLabel: string;
  className?: string;
}

export interface ToggleSlotProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when the caller renders the row text itself. */
  ariaLabel?: string;
  id?: string;
  className?: string;
}

export type StatusTone = "idle" | "queued" | "running" | "success" | "warning" | "error";

export interface StatusSlotProps {
  tone: StatusTone;
  size?: "xs" | "sm" | "md";
  /** Breathing/pulsing indicator, used for live runs. */
  pulse?: boolean;
  title?: string;
  /** Accessible text; falls back to `title`. */
  label?: string;
  className?: string;
}

export interface FieldSlotProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md";
  invalid?: boolean;
}

// ─── Shell ───────────────────────────────────────────────────────────────────

/**
 * The session-row slot is a **row shell**, not a row's content.
 *
 * `SessionSidebar` owns the session tree, so everything that makes a row work
 * (selection, rename, archive confirmation, hover actions, fork tooltips) stays
 * there and arrives as `children`. What the kit owns is the *box*: height,
 * indent, radius, the selected/hovered surface, and the class hooks the Claude
 * layer reads. That split is what lets the row be switched without the two kits
 * ever disagreeing about behaviour.
 *
 * `variant` names the sidebar view, because the two views have genuinely
 * different pi geometry (the fork tree is a fixed-height single line with a
 * 0px radius fallback; the accordion group is a two-line column with 6px).
 */
export interface SessionRowSlotProps {
  /** Which sidebar view draws this row. */
  variant: "tree" | "group";
  /** Fork indent level — 0 for a root row. */
  depth: number;
  selected: boolean;
  running?: boolean;
  unread?: boolean;
  /** Pointer is over the row; drives the hovered surface. */
  hovered?: boolean;
  /** Archive confirmation is open: the row keeps the selected surface. */
  armed?: boolean;
  /** Archive confirmation or inline rename is open: the row stops being clickable. */
  inert?: boolean;
  /** Archive in flight — the row dims. */
  deleting?: boolean;
  onSelect: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  /** The sidebar anchors its fixed tooltips to this node. */
  containerRef?: Ref<HTMLDivElement>;
  className?: string;
  children: ReactNode;
}

export interface SlotPropsMap {
  // primitives
  button: ButtonSlotProps;
  segmented: SegmentedSlotProps;
  toggle: ToggleSlotProps;
  status: StatusSlotProps;
  field: FieldSlotProps;

  // overlay — dialogs and their contents
  dialogShell: ComponentProps<typeof ConfigPanelShell>;
  approvalCard: ComponentProps<typeof ApprovalModal>;
  planReview: ComponentProps<typeof PlanReviewDialog>;
  trustDialog: ComponentProps<typeof ProjectTrustDialog>;
  queueRecovery: ComponentProps<typeof QueueRecoveryDialog>;
  palette: ComponentProps<typeof CommandPalette>;
  imageLightbox: ComponentProps<typeof ImagePreview>;

  // shell
  titleBar: ComponentProps<typeof AppTitleBar>;
  sidebar: ComponentProps<typeof SessionSidebar>;
  sessionRow: SessionRowSlotProps;
  tabBar: ComponentProps<typeof TabBar>;
  composer: ComponentProps<typeof ChatInput>;
  modelSwitcher: ComponentProps<typeof ModelSelector>;
  fileViewer: ComponentProps<typeof FileViewer>;

  // conversation
  messageList: ComponentProps<typeof VirtualizedMessageList>;
  messageShell: ComponentProps<typeof MessageView>;
  thinking: ComponentProps<typeof ThinkingBlock>;
  toolCard: ComponentProps<typeof ProcessGroup>;
  subagentRow: ComponentProps<typeof SubagentRunRow>;
  subagentPanel: ComponentProps<typeof AgentSessionPanel>;
  compaction: ComponentProps<typeof CompactionSummary>;
}