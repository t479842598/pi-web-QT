"use client";

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ElementType, type MouseEvent, type ReactNode } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { copyText } from "@/lib/clipboard";
import { resolveLocalFileHref } from "@/lib/file-links";
import { splitStableParts } from "@/lib/markdown-incremental";
import { headingId, markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { prismTheme } from "@/lib/prism-theme";
import { QuoteReplyPopover } from "./QuoteReplyPopover";
import { parseParagraph, type ParsedSegment } from "@/lib/quote-reply";
import { prepareSvgForZoomPan, ZoomPanViewer } from "./ZoomPanViewer";



interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onQuoteReply?: (quote: string) => void;
}

interface MarkdownComponentsOptions {
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onQuoteReply?: (quote: string) => void;
  quoteScope?: string;
}

const QuoteOpenContext = createContext<{ openId: string | null; setOpenId: (id: string | null) => void }>({
  openId: null,
  setOpenId: () => {},
});

function buildMarkdownComponents({ isStreaming, cwd, onOpenFile, onQuoteReply, quoteScope = "markdown" }: MarkdownComponentsOptions): Components {
  return {
    h1({ children }: React.ComponentProps<'h1'>) {
      return <h1 id={headingId(children)} className="scroll-mt-24 text-xl font-semibold mt-4 mb-2 text-(--text)">{children}</h1>
    },
    h2({ children }: React.ComponentProps<'h2'>) {
      return <h2 id={headingId(children)} className="scroll-mt-24 text-lg font-semibold mt-3 mb-2 text-(--text)">{children}</h2>
    },
    h3({ children }: React.ComponentProps<'h3'>) {
      return <h3 id={headingId(children)} className="scroll-mt-24 text-base font-semibold mt-3 mb-1 text-(--text)">{children}</h3>
    },
    code({ className, children, ...props }: React.ComponentProps<'code'> & ExtraProps) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={isStreaming} />;
      }
      return (
        <code
          className="inline max-w-full whitespace-normal break-words [overflow-wrap:anywhere] align-baseline bg-(--bg-secondary) border border-(--border) px-1.5 py-0.5 text-xs font-mono text-(--accent-blue)"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }: React.ComponentProps<'pre'> & ExtraProps) {
      return <>{children}</>;
    },
    p({ children, node, ...props }: React.ComponentProps<'p'> & ExtraProps) {
      const pid = `${quoteScope}-p-${node?.position?.start?.offset ?? 0}`;
      if (!onQuoteReply) return <p {...props}>{children}</p>;
      return (
        <QuoteableParagraph pid={pid} onQuoteReply={onQuoteReply} onOpenFile={onOpenFile} cwd={cwd}>
          {children}
        </QuoteableParagraph>
      );
    },
    li({ children, node, ...props }: React.ComponentProps<'li'> & ExtraProps) {
      const pid = `${quoteScope}-li-${node?.position?.start?.offset ?? 0}`;
      if (!onQuoteReply) return <li {...props}>{children}</li>;
      return (
        <QuoteableParagraph as="li" pid={pid} onQuoteReply={onQuoteReply} onOpenFile={onOpenFile} cwd={cwd}>
          {children}
        </QuoteableParagraph>
      );
    },
    a({ href, children, ...props }: React.ComponentProps<'a'> & ExtraProps) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const linkClass = "text-(--accent-blue) underline underline-offset-2 hover:text-(--accent-blue)/80";
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <a href={href} {...props} className={linkClass} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a href={href} {...props} className={linkClass} onClick={handleClick}>
          {children}
        </a>
      );
    },
    table({ children }: React.ComponentProps<'table'> & ExtraProps) {
      return (
        <div className="my-3 rounded-lg overflow-hidden border border-(--border)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse [&_tr:last-child>td]:border-b-0">
              {children}
            </table>
          </div>
        </div>
      );
    },
    tr({ children, node, ...props }: React.ComponentProps<'tr'> & ExtraProps) {
      const pid = `${quoteScope}-tr-${node?.position?.start?.offset ?? 0}`;
      if (!onQuoteReply) return <tr {...props}>{children}</tr>;
      return (
        <QuoteableParagraph as="tr" pid={pid} onQuoteReply={onQuoteReply} onOpenFile={onOpenFile} cwd={cwd}>
          {children}
        </QuoteableParagraph>
      );
    },
  };
}

/**
 * One stable Markdown chunk. React.memo skips re-render while the chunk text
 * is unchanged (reference-equal via the interning cache in splitStableParts),
 * so the remark/rehype pipeline only runs for the streaming tail chunk.
 * Stable chunks are marked non-streaming: their closed code blocks get Prism
 * highlighting immediately instead of waiting for the whole message to end.
 */
const MarkdownPart = memo(function MarkdownPart({ text, isStreaming, cwd, onOpenFile, onQuoteReply, quoteScope }: {
  text: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onQuoteReply?: (quote: string) => void;
  quoteScope: string;
}) {
  const normalized = useMemo(() => normalizeDisplayMath(text), [text]);
  const components = useMemo(
    () => buildMarkdownComponents({ isStreaming, cwd, onOpenFile, onQuoteReply, quoteScope }),
    [isStreaming, cwd, onOpenFile, onQuoteReply, quoteScope],
  );
  return (
    <ReactMarkdown
      remarkPlugins={markdownRemarkPlugins}
      rehypePlugins={markdownRehypePlugins}
      components={components}
    >
      {normalized}
    </ReactMarkdown>
  );
});

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, onQuoteReply }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // Interning map: stable chunk text stays reference-stable so MarkdownPart
  // memo comparisons hit with === and skip the parse/render work entirely.
  const partCacheRef = useRef<Map<string, string>>(new Map());
  const parts = useMemo(
    () => splitStableParts(normalizedMarkdown, partCacheRef.current),
    [normalizedMarkdown],
  );
  const streamingSplit = isStreaming && parts.length > 1;
  const components = useMemo(
    () => buildMarkdownComponents({ isStreaming, cwd, onOpenFile, onQuoteReply, quoteScope: "full" }),
    [isStreaming, cwd, onOpenFile, onQuoteReply],
  );

  return (
    <QuoteReplyScope>
      <div className={["markdown-body", className].filter(Boolean).join(" ")}>
        {streamingSplit ? (
          parts.map((part) => (
            <MarkdownPart
              key={part.id}
              text={part.text}
              isStreaming={part.tail ? isStreaming : false}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onQuoteReply={onQuoteReply}
              quoteScope={part.id}
            />
          ))
        ) : (
          <ReactMarkdown
            remarkPlugins={markdownRemarkPlugins}
            rehypePlugins={markdownRehypePlugins}
            components={components}
          >
            {normalizedMarkdown}
          </ReactMarkdown>
        )}
      </div>
    </QuoteReplyScope>
  );
}

function QuoteReplyScope({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return <QuoteOpenContext.Provider value={value}>{children}</QuoteOpenContext.Provider>;
}

export function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [showPreview, setShowPreview] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;

  useEffect(() => {
    if (!showPreview || isStreaming) return;

    let cancelled = false;
    setFailedKey(null);

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: isDark ? "dark" : "default",
      });

      const parsed = await mermaid.parse(code, { suppressErrors: true });
      if (!parsed) throw new Error("Invalid Mermaid diagram");

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await mermaid.render(id, code);
      if (!cancelled) {
        setSvg(result.svg);
        setRenderedKey(currentKey);
      }
    };

    render().catch(() => {
      if (!cancelled) setFailedKey(currentKey);
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, isStreaming, showPreview]);

  const previewButton = (
    <button
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={isStreaming
              ? t("desktop.markdownPreviewAvailableAfterStreaming")
              : (showPreview ? t("desktop.source") : t("desktop.markdownPreviewMermaidDiagram"))}
      className={["markdown-code-action", showPreview ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {showPreview ? t("desktop.source") : t("desktop.preview")}
    </button>
  );

  if (!showPreview || isStreaming) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} isStreaming={isStreaming} />;
  }

  const body =
    failedKey === currentKey ? (
      <div className="mermaid-block mermaid-block-error">{t("desktop.markdownInvalidMermaidDiagram")}</div>
    ) : !svg || renderedKey !== currentKey ? (
      <div className="mermaid-block mermaid-block-loading" aria-label={t("desktop.markdownRenderingMermaidDiagram")} />
    ) : (
      <>
        <button
          type="button"
          className="mermaid-block mermaid-preview-button"
          title={t("desktop.openMermaidViewer")}
          aria-label={t("desktop.openMermaidViewer")}
          onClick={() => setZoomOpen(true)}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {zoomOpen && <MermaidZoomDialog svg={svg} onClose={() => setZoomOpen(false)} />}
      </>
    );

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">mermaid</span>
        <div className="markdown-code-actions">{previewButton}</div>
      </div>
      {body}
    </div>
  );
}

function MermaidZoomDialog({ svg, onClose }: { svg: string; onClose: () => void }) {
  const { t } = useI18n();
  const prepared = useMemo(() => prepareSvgForZoomPan(svg), [svg]);

  return (
    <ZoomPanViewer
      contentWidth={prepared.width}
      contentHeight={prepared.height}
      title={t("desktop.mermaidDiagram")}
      ariaLabel={t("desktop.mermaidViewer")}
      onClose={onClose}
    >
      <div dangerouslySetInnerHTML={{ __html: prepared.html }} />
    </ZoomPanViewer>
  );
}

function QuoteableParagraph({
  children,
  onQuoteReply,
  onOpenFile,
  cwd,
  as = "p",
  pid,
}: {
  children: ReactNode;
  onQuoteReply: (quote: string) => void;
  onOpenFile?: (filePath: string) => void;
  cwd?: string;
  as?: "p" | "li" | "tr";
  pid: string;
}) {
  const { openId, setOpenId } = useContext(QuoteOpenContext);
  const { t } = useI18n();
  const open = openId === pid;
  const ref = useRef<HTMLElement>(null);
  const [segments, setSegments] = useState<ParsedSegment[] | null>(null);
  const [showTip, setShowTip] = useState(false);
  const [tableColumnCount, setTableColumnCount] = useState(1);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [coarse] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches);

  useEffect(() => {
    if (!open && segments) setSegments(null);
  }, [open, segments]);

  const popoverRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (segments && popoverRef.current) popoverRef.current.scrollIntoView({ block: "nearest" });
  }, [segments]);

  const openPopover = () => {
    if (segments || open) return;
    const element = ref.current;
    const text = as === "tr" && element
      ? Array.from(element.querySelectorAll("td, th")).map((cell) => (cell.textContent ?? "").trim()).join(" | ")
      : (element?.textContent ?? "");
    const parsed = parseParagraph(text);
    if (parsed.length > 0) {
      if (as === "tr" && element) {
        setTableColumnCount(Math.max(1, element.querySelectorAll("td, th").length));
      }
      setSegments(parsed);
      setOpenId(pid);
    }
  };
  const closePopover = () => {
    setSegments(null);
    setOpenId(null);
  };
  const toggle = () => {
    if (segments) closePopover();
    else openPopover();
  };
  const moveTip = (x: number, y: number) => {
    if (!tipRef.current) return;
    tipRef.current.style.left = `${x + 12}px`;
    tipRef.current.style.top = `${y + 14}px`;
  };
  const showTooltip = (event: MouseEvent<HTMLElement>) => {
    if (coarse) return;
    setShowTip(true);
    const { clientX, clientY } = event;
    requestAnimationFrame(() => moveTip(clientX, clientY));
  };
  const Tag = as as ElementType;
  const popover = segments && (
    <QuoteReplyPopover
      innerRef={popoverRef}
      segments={segments}
      onPick={(quote) => { onQuoteReply(quote); closePopover(); }}
      onOpenFile={onOpenFile}
      cwd={cwd}
    />
  );

  if (as === "tr") {
    return (
      <>
        <tr
          ref={(element) => { ref.current = element; }}
          onClick={toggle}
          title={!coarse && !segments ? t("desktop.quoteReplyHint") : undefined}
          style={{ cursor: "pointer" }}
        >
          {children}
        </tr>
        {popover && (
          <tr>
            <td colSpan={tableColumnCount}>{popover}</td>
          </tr>
        )}
      </>
    );
  }

  return (
    <Tag
      ref={ref}
      onMouseEnter={showTooltip}
      onMouseMove={coarse ? undefined : (event: MouseEvent<HTMLElement>) => moveTip(event.clientX, event.clientY)}
      onMouseLeave={() => setShowTip(false)}
      onClick={toggle}
      style={{ position: "relative", cursor: "pointer" }}
    >
      {children}
      {showTip && !segments && (
        <span
          ref={tipRef}
          style={{
            position: "fixed", left: -9999, top: -9999, fontSize: 11, color: "var(--text-dim)",
            background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 4,
            padding: "2px 6px", pointerEvents: "none", zIndex: 50, whiteSpace: "nowrap",
          }}
        >
          {t("desktop.quoteReplyHint")}
        </span>
      )}
      {popover}
    </Tag>
  );
}

export function CodeBlock({ code, lang, headerAction, isStreaming }: { code: string; lang: string; headerAction?: ReactNode; isStreaming?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="markdown-code-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        position: "absolute",
        top: 6,
        right: 8,
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: 6,
        opacity: hovered ? 1 : 0,
        pointerEvents: hovered ? "auto" : "none",
        transition: "opacity 0.12s",
      }}>
        <span style={{
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          userSelect: "none",
        }}>{lang || t("desktop.markdownPlainText")}</span>
        {headerAction}
        <button
          onClick={copy}
          title={copied ? t("desktop.copied") : t("desktop.copy")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            border: "none",
            borderRadius: 5,
            background: "transparent",
            color: copied ? "var(--accent)" : "var(--text-dim)",
            cursor: "pointer",
            fontSize: 10,
            transition: "color 0.12s",
          }}
          onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
        >
          {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
        </button>
      </div>
      {isStreaming ? (
        // Prism tokenization is synchronous and grows with the whole unfinished
        // block. Preserve readable source while streaming, then highlight once
        // the final message replaces this transient view.
        <pre className="markdown-code-streaming"><code>{code}</code></pre>
      ) : (
        <SyntaxHighlighter
          language={lang || "text"}
          style={prismTheme}
          showLineNumbers={false}
          customStyle={{
            margin: 0,
            padding: "10px 16px",
            fontSize: 13,
            lineHeight: 1.65,
            borderRadius: 0,
            border: "none",
            background: "var(--bg-secondary)",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
        >
          {code}
        </SyntaxHighlighter>
      )}
    </div>
  );
}
