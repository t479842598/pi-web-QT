"use client";

/**
 * Claude shell — file viewer.
 *
 * The viewer body (syntax highlighting, markdown, PDF/image/document previews,
 * diff mode, in-place editing, live watch) is the pi implementation, rendered
 * unchanged: FileViewer branches on the path type before any chrome exists, so
 * copying it would mean maintaining four renderers in two places.
 *
 * This slot supplies the CDS shell around it — a 12px card with one hairline
 * ring and the popover elevation, inset from the panel edge. The status bar
 * pi renders keeps its inline geometry (it is styled per-renderer), but it now
 * sits inside the card instead of on the panel's raw surface, and the card's
 * radius clips it.
 */

import type { ComponentProps } from "react";

import { FileViewer } from "@/components/FileViewer";

export type ClaudeFileViewerProps = ComponentProps<typeof FileViewer>;

export function ClaudeFileViewer(props: ClaudeFileViewerProps) {
  return (
    <div className="claude-file-viewer" data-claude-shell="fileViewer">
      <div className="claude-file-viewer-card">
        <FileViewer {...props} />
      </div>
    </div>
  );
}
