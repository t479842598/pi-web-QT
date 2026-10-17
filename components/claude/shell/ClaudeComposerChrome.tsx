"use client";

/**
 * Claude shell — composer chrome.
 *
 * ChatInput carries 3.5k lines of behaviour (slash commands, @-files, images,
 * queue, history, IME, drafts, streaming). None of it is reimplemented here:
 * this component is the *frame* the four zones are placed in, and the pi
 * composer keeps owning its own markup. The contract is four ReactNode slots —
 * leading / editor / trailing / footer — plus an optional status strip.
 *
 * Geometry comes from CDS: 20px shell radius, one closed hairline ring, a
 * focus glow on the shell only (never a browser outline), and the density
 * tokens (--cds-gap-*, --cds-control-height) read with px fallbacks because
 * they only exist inside html[data-ui-kit="claude"].
 *
 * The "chin" is a three-column grid: auto / 1fr / auto. Below 560px the shell
 * collapses to attach + send, and the middle group moves into the overflow
 * menu the caller supplies through `overflow`. That collapse is pure CSS
 * (.claude-composer.is-narrow), so no re-render or JS breakpoint is involved.
 */

import type { CSSProperties, ReactNode } from "react";

export interface ClaudeComposerChromeProps {
  /** Left cluster: attach menu, mode picker, model switcher. */
  leading?: ReactNode;
  /** The textarea and its inline decorations. */
  editor: ReactNode;
  /** Right cluster: thinking level, tool preset, send/stop. */
  trailing?: ReactNode;
  /** Row under the editor: context chip, hints, queue banner. */
  footer?: ReactNode;
  /** Above the shell: retry/compaction banners. */
  status?: ReactNode;
  /** Controls that move into the "more" menu below 560px. */
  overflow?: ReactNode;
  /** Streaming pins the resting elevation instead of the focus glow. */
  streaming?: boolean;
  /** Unrestricted approval mode paints the danger ring. */
  danger?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function ClaudeComposerChrome({
  leading,
  editor,
  trailing,
  footer,
  status,
  overflow,
  streaming = false,
  danger = false,
  className,
  style,
  children,
}: ClaudeComposerChromeProps) {
  return (
    <div className={["claude-composer", className].filter(Boolean).join(" ")} style={style}>
      {status && <div className="claude-composer-status">{status}</div>}
      <div
        className={[
          "claude-composer-shell",
          streaming ? "is-streaming" : "",
          danger ? "is-danger" : "",
        ].filter(Boolean).join(" ")}
      >
        <div className="claude-composer-editor">{editor}</div>
        <div className="claude-composer-chin">
          <div className="claude-composer-left">
            {leading}
            {overflow && <div className="claude-composer-overflow">{overflow}</div>}
          </div>
          <div className="claude-composer-center">{children}</div>
          <div className="claude-composer-right">{trailing}</div>
        </div>
        {footer && <div className="claude-composer-footer">{footer}</div>}
      </div>
    </div>
  );
}
