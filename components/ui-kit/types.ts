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

import type { ButtonHTMLAttributes, ComponentProps, InputHTMLAttributes, MouseEvent, ReactNode } from "react";

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

export interface ScrollFadeSlotProps {
  children: ReactNode;
  className?: string;
  edges?: "top" | "bottom" | "both" | "none";
  /** Px of the fade gradient; defaults to the kit's own token. */
  size?: number;
}

// ─── Shell ───────────────────────────────────────────────────────────────────

/**
 * Session rows are rendered inline by `SessionSidebar` today, so there is no pi
 * component to derive from; the contract is declared here and the pi adapter
 * reproduces the current row markup.
 */
export interface SessionRowSlotProps {
  title: string;
  subtitle?: string;
  active: boolean;
  running?: boolean;
  unread?: boolean;
  depth?: number;
  onClick: () => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  /** Trailing controls (fork, delete, rename…). */
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export interface SlotPropsMap {
  // primitives
  button: ButtonSlotProps;
  segmented: SegmentedSlotProps;
  toggle: ToggleSlotProps;
  status: StatusSlotProps;
  field: FieldSlotProps;
  scrollFade: ScrollFadeSlotProps;

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
