"use client";

import type { ComponentProps, ComponentType } from "react";

import { useSlot } from "@/components/ui-kit";
import { MessageView } from "@/components/MessageView";
import { ProcessGroup } from "@/components/ProcessGroup";
import { SubagentRunRow } from "@/components/SubagentRunRow";
import { AgentSessionPanel } from "@/components/AgentSessionPanel";
import { VirtualizedMessageList } from "@/components/VirtualizedMessageList";
import { ThinkingBlock } from "@/components/MessageView";

/**
 * Conversation render proxies.
 *
 * `ChatWindow` keeps owning the transcript: it decides how raw entries group into
 * ProcessGroups, where subagent segments split out, and which item keys the
 * virtualizer sees. This module only answers "which component draws the row",
 * so swapping a kit changes presentation and nothing else.
 *
 * Each proxy falls back to the pi component. That fallback is not a stub — it is
 * the shipping implementation, and while `kit === "pi"` it is what renders, so
 * the pi transcript stays byte-identical by construction.
 */

/** Renders the winning `messageShell` implementation for the active kit. */
export function MessageRow(props: ComponentProps<typeof MessageView>) {
  const Impl = useSlot("messageShell") as ComponentType<ComponentProps<typeof MessageView>> | null;
  const Component = Impl ?? MessageView;
  return <Component {...props} />;
}

export function ProcessRow(props: ComponentProps<typeof ProcessGroup>) {
  const Impl = useSlot("toolCard") as ComponentType<ComponentProps<typeof ProcessGroup>> | null;
  const Component = Impl ?? ProcessGroup;
  return <Component {...props} />;
}

export function TranscriptList(props: ComponentProps<typeof VirtualizedMessageList>) {
  const Impl = useSlot("messageList") as
    | ComponentType<ComponentProps<typeof VirtualizedMessageList>>
    | null;
  const Component = Impl ?? VirtualizedMessageList;
  return <Component {...props} />;
}

export function SubagentRow(props: ComponentProps<typeof SubagentRunRow>) {
  const Impl = useSlot("subagentRow") as ComponentType<ComponentProps<typeof SubagentRunRow>> | null;
  const Component = Impl ?? SubagentRunRow;
  return <Component {...props} />;
}

export function SubagentBoard(props: ComponentProps<typeof AgentSessionPanel>) {
  const Impl = useSlot("subagentPanel") as ComponentType<ComponentProps<typeof AgentSessionPanel>> | null;
  const Component = Impl ?? AgentSessionPanel;
  return <Component {...props} />;
}

export function ThinkingRow(props: ComponentProps<typeof ThinkingBlock>) {
  const Impl = useSlot("thinking") as ComponentType<ComponentProps<typeof ThinkingBlock>> | null;
  const Component = Impl ?? ThinkingBlock;
  return <Component {...props} />;
}
