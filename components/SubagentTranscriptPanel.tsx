"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MessageView } from "./MessageView";
import { ProcessGroup } from "./ProcessGroup";
import { buildHistoryPipeline, type HistoryPipeline } from "@/lib/chat-history-pipeline";
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "@/lib/types";

interface Props {
  sessionId: string;
  /** Row label (subagent description) so the header reads even before load. */
  label?: string;
  /** True while the parent turn still shows this subagent as running. */
  running?: boolean;
  onOpenFile?: (filePath: string) => void;
}

interface SessionPayload {
  context?: { messages?: AgentMessage[]; entryIds?: string[] };
  error?: string;
}

const POLL_MS = 2500;

/**
 * Read-only view of a subagent run, hosted as a right-panel tab.
 *
 * The run is a real persisted Pi session, so this reuses `GET /api/sessions`
 * and renders through the same turn-grouping pipeline as the main chat:
 * historical thinking/tool-call groups collapse into a ProcessGroup (compact
 * after a run, expanded while it streams), only the final answer stays open.
 * Streaming state is approximated by the `running` prop — good enough to keep
 * the latest turn open without a second SSE connection.
 */
export function SubagentTranscriptPanel({ sessionId, label, running = false, onOpenFile }: Props) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?tail=500`, { cache: "no-store" });
        const data = await res.json() as SessionPayload;
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setMessages(data.context?.messages ?? []);
        setEntryIds(data.context?.entryIds ?? []);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // Keep the last good transcript on a transient refresh failure.
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load(true);
    return () => { cancelled = true; };
  }, [sessionId]);

  // While the run is live, poll so the panel keeps up without a second SSE
  // connection. Stops as soon as the parent stops reporting it as running.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?tail=500`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as SessionPayload;
        if (cancelled) return;
        setMessages(data.context?.messages ?? []);
        setEntryIds(data.context?.entryIds ?? []);
      } catch {
        // A missed poll is not worth surfacing; the next one retries.
      }
    }, POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [running, sessionId]);

  const toolResults = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
    }
    return map;
  }, [messages]);

  // Same pipeline as the main chat: turns, process blocks, subagent rows.
  const pipeline: HistoryPipeline = useMemo(
    () => buildHistoryPipeline(messages, entryIds, undefined, toolResults),
    [messages, entryIds, toolResults],
  );

  const visibleCount = useMemo(
    () => messages.filter((m) => m.role === "user" || m.role === "assistant").length,
    [messages],
  );

  const renderMessage = (idx: number, overrides?: { messageOverride?: AssistantMessage }) => (
    <MessageView
      key={`subagent-msg-${idx}`}
      message={overrides?.messageOverride ?? (messages[idx] as AssistantMessage)}
      toolResults={pipeline.toolResultsMap}
      entryId={entryIds[idx]}
      sessionId={sessionId}
      onOpenFile={onOpenFile}
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
        padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)",
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label || t("subagent.transcriptTitle")}
        </span>
        {running && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--accent)", whiteSpace: "nowrap" }}>
            {t("agentSwitcher.status.running")}
          </span>
        )}
      </div>

      <div className="scrollbar-subtle scroll-overlay" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 12px" }}>
        {loading && messages.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("subagent.transcriptLoading")}</div>
        )}
        {error && messages.length === 0 && (
          <div style={{ color: "var(--status-error)", fontSize: 12 }}>
            {t("subagent.transcriptFailed", { error })}
          </div>
        )}
        {!loading && !error && visibleCount === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
            {/* A just-started run has no persisted messages yet; saying so reads
                better than the generic empty state while it keeps polling. */}
            {running ? t("subagent.transcriptWaiting") : t("subagent.transcriptEmpty")}
          </div>
        )}
        {pipeline.items.map((item, itemIdx) => {
          if (item.kind === "single") {
            return (
              <div key={`single-${item.idx}`}>
                {renderMessage(item.idx)}
              </div>
            );
          }
          const { userIdx, endIdx, finalAssistantIdx, finalAnswerMessage } = item;
          // The live (last) turn keeps its process group expanded while the
          // subagent runs; every historical turn stays collapsed like main chat.
          const isLatestTurn = itemIdx === pipeline.items.length - 1;
          const turnStreaming = running && isLatestTurn;
          return (
            <div key={`turn-${userIdx}-${itemIdx}`}>
              {userIdx >= 0 && renderMessage(userIdx)}
              {item.processSegments.map((segment, segmentIdx) => (
                <ProcessGroup
                  key={`seg-${userIdx}-${segmentIdx}`}
                  blocks={segment.blocks}
                  isStreaming={turnStreaming && segmentIdx === item.processSegments.length - 1 && finalAssistantIdx === -1}
                  defaultExpanded={turnStreaming && segmentIdx === item.processSegments.length - 1 && finalAssistantIdx === -1}
                  onOpenFile={onOpenFile}
                />
              ))}
              {finalAnswerMessage && renderMessage(finalAssistantIdx, { messageOverride: finalAnswerMessage })}
              {finalAssistantIdx >= 0 && (() => {
                const tails = [];
                for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
                  tails.push(<div key={`tail-${renderIdx}`}>{renderMessage(renderIdx)}</div>);
                }
                return tails;
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
