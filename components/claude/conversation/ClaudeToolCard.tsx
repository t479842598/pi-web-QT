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

/**
 * Body for a step when the caller supplies no `renderStep`.
 *
 * No consumer passes one today, so this is the only path that actually runs.
 * It renders whatever text the block carries — the call arguments for a tool
 * call, the prose for a text block — which is what makes the transcript readable
 * instead of a list of tool names.
 */
function FallbackStepBody({ block }: { block: ProcessContentBlock }) {
  const body = (() => {
    switch (block.type) {
      case "text":
        return block.text;
      case "thinking":
        return block.thinking ?? "";
      case "toolCall": {
        const input = block.input;
        if (typeof input === "string") return input;
        try {
          return JSON.stringify(input, null, 2);
        } catch {
          return "";
        }
      }
      case "custom":
        // A custom block carries a whole message; its text is the useful part.
        return typeof block.message.content === "string" ? block.message.content : "";
      default:
        return "";
    }
  })();

  if (!body.trim()) return null;

  return (
    <pre
      style={{
        margin: 0,
        fontSize: "var(--text-ui-xs)",
        lineHeight: 1.55,
        color: "var(--cds-text-secondary, var(--text-muted))",
        fontFamily: "var(--font-mono)",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        maxHeight: "16rem",
        overflowY: "auto",
      }}
    >
      {body.length > 4000 ? body.slice(0, 4000) + "…" : body}
    </pre>
  );
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
  // Collapsed by default, which is the convention this shell follows: a run of
  // tool calls reads as one scannable row. Expanding everything instead produced
  // 30k characters where pi shows 2k — the opposite failure.
  //
  // What a collapsed row must not do is hide *what happened*, so the summary
  // line carries the first step's title and the count; the bodies are one click
  // away.
  const [open, setOpen] = useState(defaultExpanded);
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
        {/* Collapsed rows must still say *what* ran. A bare count made every run
            look the same; naming the tools is what a reader scans for. */}
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--cds-text-faint, var(--text-dim))",
            fontSize: "var(--text-ui-xs)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {blocks
            .slice(0, 4)
            .map((block) => stepTitle(block, 0))
            .filter(Boolean)
            .join(" · ")}
          {blocks.length > 4 ? ` · +${blocks.length - 4}` : ""}
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
                  {/* `renderStep` is optional, and no caller passes one today.
                      Without a fallback the "expanded" body showed only the title
                      line, so the content loss survived the first fix. Render the
                      block's own text when the caller does not supply a body. */}
                  <div style={{ marginTop: 4 }}>
                    {renderStep ? renderStep(block, index) : <FallbackStepBody block={block} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
