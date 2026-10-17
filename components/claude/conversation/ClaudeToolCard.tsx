"use client";

import { useState, type ReactNode } from "react";

import type { ProcessContentBlock } from "@/lib/process-content";

/**
 * CDS tool-call card.
 *
 * Contract: `ComponentProps<typeof ProcessGroup>`. The pi version renders a
 * collapsible run of steps with per-step results; this keeps the same step data
 * (`blocks` come from `buildProcessBlocks`) and the same callbacks, and changes
 * the frame: hairline-separated rows, a single status dot per step driven by the
 * existing `--status-*` tokens, and a summary line that states how many steps
 * ran and whether any failed.
 *
 * Step bodies are delegated through `renderStep` when the caller supplies it —
 * the tool result rendering (ANSI, images, paired diffs) belongs to the shared
 * pipeline, not to the skin.
 */

export interface ClaudeToolCardProps {
  blocks: ProcessContentBlock[];
  isStreaming?: boolean;
  defaultExpanded?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
  tokenRate?: number | null;
  /** Optional per-step body renderer from the caller (shared pipeline). */
  renderStep?: (block: ProcessContentBlock, index: number) => ReactNode;
}

function stepTone(block: ProcessContentBlock): { color: string; label: string } {
  // `status` only exists on the toolCall member; everything else is a finished
  // text/thinking/image/custom block by the time it reaches a group.
  const state = block.type === "toolCall" ? block.status : "success";
  if (state === "error") return { color: "var(--status-error)", label: "failed" };
  if (state === "running") return { color: "var(--accent)", label: "running" };
  return { color: "var(--status-success)", label: "done" };
}

function stepTitle(block: ProcessContentBlock, index: number): string {
  switch (block.type) {
    case "toolCall":
      return block.toolName;
    case "text":
      return block.text.slice(0, 60) || `Step ${index + 1}`;
    case "thinking":
      return "thinking";
    case "image":
      return "image";
    case "custom":
      return block.customType;
    default:
      return `Step ${index + 1}`;
  }
}

export function ClaudeToolCard({
  blocks,
  isStreaming = false,
  defaultExpanded = false,
  renderStep,
}: ClaudeToolCardProps) {
  const [open, setOpen] = useState(defaultExpanded || isStreaming);
  const total = blocks?.length ?? 0;
  if (total === 0) return null;

  const failures = blocks.filter((block) => stepTone(block).label === "failed").length;

  return (
    <div
      style={{
        marginBlock: 8,
        borderRadius: "var(--cds-radius-card, 12px)",
        border: "0.5px solid var(--cds-hairline-1, var(--border))",
        background: "var(--cds-surface-1, var(--bg-panel))",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          border: "none",
          background: "none",
          color: "var(--cds-text-secondary, var(--text-muted))",
          fontSize: "var(--text-ui-sm)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background: isStreaming
              ? "var(--cds-clay, var(--accent))"
              : failures > 0
                ? "var(--status-error)"
                : "var(--status-success)",
            animation: isStreaming ? "tab-breathe 1.8s ease-in-out infinite" : undefined,
          }}
        />
        <span style={{ fontWeight: 500 }}>
          {total} step{total === 1 ? "" : "s"}
          {failures > 0 ? ` · ${failures} failed` : ""}
        </span>
        <span
          aria-hidden="true"
          style={{
            marginLeft: "auto",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 160ms var(--cds-ease-swift, ease)",
            fontSize: "var(--text-ui-xs)",
          }}
        >
          ›
        </span>
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms var(--cds-ease-expand, ease)",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          {blocks.map((block, index) => {
            const tone = stepTone(block);
            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "7px 12px",
                  borderTop: index === 0 ? "none" : "0.5px solid var(--cds-hairline-1, var(--border))",
                  alignItems: "flex-start",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    marginTop: 6,
                    flexShrink: 0,
                    background: tone.color,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: "var(--text-ui-sm)",
                      color: "var(--cds-text-primary, var(--text))",
                      fontFamily: "var(--font-mono)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {stepTitle(block, index)}
                  </div>
                  {renderStep && (
                    <div style={{ marginTop: 4 }}>
                      {renderStep(block, index)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
