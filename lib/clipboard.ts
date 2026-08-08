export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch {
    return Promise.reject();
  }
}

/**
 * Strip common Markdown syntax to a plain-text approximation for "copy as
 * plain text". Handles the constructs pi's markdown renderer emits most:
 * headings, emphasis, links, inline code, code fences, lists, blockquotes,
 * tables and strikethrough. Not a full CommonMark parser — good enough for
 * pasting a reply into a plain-text editor.
 */
export function markdownToPlainText(markdown: string): string {
  let text = markdown;
  // Inline code first (backticks are not emphasis).
  text = text.replace(/`([^`]+)`/g, "$1");
  // Code fences: keep their content, drop the fence lines.
  text = text.replace(/```[^\n]*\n?/g, "\n").replace(/```/g, "\n");
  // Images and links → keep the visible label.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Bold / italic / strikethrough.
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)([^*_]+)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");
  // Headings.
  text = text.replace(/^#{1,6}\s+/gm, "");
  // Blockquote markers.
  text = text.replace(/^>\s?/gm, "");
  // List markers (-, *, +, 1.) at line starts.
  text = text.replace(/^(\s*)([-*+]|\d+\.)\s+/gm, "$1");
  // Tables: collapse divider rows, join cells with a space.
  text = text.replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "");
  text = text.replace(/\|/g, " ");
  // Collapse 3+ blank lines and trim.
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}
