import type { CSSProperties } from "react";

/**
 * Prism emits token colors as inline styles. These must stay tied to the same
 * CSS variables as the surrounding surface: selecting a separate static dark
 * or light Prism theme makes code text lag one React render behind a View
 * Transition's CSS-variable update.
 */
export const prismTheme: Record<string, CSSProperties> = {
  'pre[class*="language-"]': {
    color: "var(--text)",
    background: "transparent",
  },
  'code[class*="language-"]': {
    color: "var(--text)",
    background: "transparent",
  },
  comment: { color: "var(--syntax-comment, var(--text-dim))", fontStyle: "italic" },
  prolog: { color: "var(--syntax-comment, var(--text-dim))", fontStyle: "italic" },
  doctype: { color: "var(--syntax-comment, var(--text-dim))", fontStyle: "italic" },
  cdata: { color: "var(--syntax-comment, var(--text-dim))" },
  punctuation: { color: "var(--text-muted)" },
  operator: { color: "var(--text-muted)" },
  string: { color: "var(--syntax-string, var(--accent-orange))" },
  char: { color: "var(--syntax-string, var(--accent-orange))" },
  builtin: { color: "var(--syntax-string, var(--accent-orange))" },
  'attr-value': { color: "var(--syntax-string, var(--accent-orange))" },
  keyword: { color: "var(--syntax-keyword, var(--accent))" },
  atrule: { color: "var(--syntax-keyword, var(--accent))" },
  property: { color: "var(--accent-blue)" },
  'attr-name': { color: "var(--accent-blue)" },
  variable: { color: "var(--accent-blue)" },
  parameter: { color: "var(--accent-blue)" },
  constant: { color: "var(--accent-blue)" },
  number: { color: "var(--syntax-number, var(--accent-blue))" },
  boolean: { color: "var(--syntax-number, var(--accent-blue))" },
  symbol: { color: "var(--syntax-number, var(--accent-blue))" },
  function: { color: "var(--syntax-function, var(--accent-green))" },
  'class-name': { color: "var(--syntax-function, var(--accent-green))" },
  'maybe-class-name': { color: "var(--syntax-function, var(--accent-green))" },
  tag: { color: "var(--accent-red)" },
  selector: { color: "var(--accent-red)" },
  regex: { color: "var(--accent-red)" },
  entity: { color: "var(--accent-red)" },
  deleted: { color: "var(--accent-red)" },
  inserted: { color: "var(--accent-green)" },
  important: { color: "var(--accent-orange)", fontWeight: "bold" },
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
};
