import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// ProcessGroup relies on many React providers (theme, i18n, timers) and a
// rich block model, so its P1 coverage is asserted at the source level:
// every Markdown-rendering path inside a step must forward `isStreaming`,
// which switches MarkdownBody into incremental (stable-part) rendering and
// defers Prism for the growing tail.

const source = await readFile(new URL("./ProcessGroup.tsx", import.meta.url), "utf8");

test("StepContent forwards isStreaming to ProcessNarrative for thinking steps", () => {
  const thinkingBranch = source.match(
    /if \(step\.kind === "thinking"\) \{[\s\S]*?return <ProcessNarrative blocks=\{step\.blocks\}[\s\S]*?isStreaming=\{isStreaming\} \/>;/,
  );
  assert.ok(thinkingBranch, "thinking step must render ProcessNarrative with isStreaming");
});

test("StepContent forwards isStreaming to ProcessNarrative for tool and toolGroup steps", () => {
  // leadBlocks narrative in single-tool steps
  assert.match(source, /<ProcessNarrative blocks=\{step\.leadBlocks\}[\s\S]*?isStreaming=\{isStreaming\} \/>/);
  // leadBlocks narrative in grouped tool steps
  assert.match(source, /<ProcessNarrative blocks=\{step\.leadBlocks\[idx\]\}[\s\S]*?isStreaming=\{isStreaming\} \/>/);
});

test("StepContent forwards isStreaming to MessageView for custom steps", () => {
  assert.match(
    source,
    /<MessageView message=\{step\.block\.message\} cwd=\{cwd\} onOpenFile=\{onOpenFile\} isStreaming=\{isStreaming\} \/>/,
  );
});

test("ProcessNarrative forwards isStreaming to MarkdownBody and ThinkingBlock", () => {
  // text narrative → MarkdownBody
  assert.match(
    source,
    /<MarkdownBody key=\{block\.id\} cwd=\{cwd\} onOpenFile=\{onOpenFile\} className="!text-text-dim" isStreaming=\{isStreaming\}>/,
  );
  // thinking narrative → ThinkingBlock (contentOnly) with isStreaming
  const thinkingCall = source.match(/<ThinkingBlock[\s\S]*?contentOnly[\s\S]*?isStreaming=\{isStreaming\}\s*\/>/);
  assert.ok(thinkingCall, "thinking narrative must render ThinkingBlock with isStreaming");
});

test("all three StepContent call sites pass isStreaming", () => {
  const calls = source.match(/<StepContent [^>]*\/>/g) ?? [];
  assert.equal(calls.length, 3, "exactly three StepContent render sites");
  for (const call of calls) {
    assert.match(call, /isStreaming=\{isStreaming\}/);
  }
});

test("step narrative keeps its dimmed styling while streaming", () => {
  // isStreaming must not bypass the existing narrative presentation.
  assert.match(source, /className="!text-text-dim" isStreaming=\{isStreaming\}/);
});

test("manual collapse during streaming is not immediately forced open again", () => {
  assert.match(source, /userCollapsedDuringStreamRef/);
  assert.match(source, /if \(!userCollapsedDuringStreamRef\.current\) setAreaExpanded\(true\)/);
  assert.match(source, /userCollapsedDuringStreamRef\.current = isStreaming && !next/);
});

test("tool blocks get a referentially stable prop object so ToolCallBlock's memo can hit", () => {
  // Regression: passing an inline object literal to the memoized ToolCallBlock
  // defeated its shallow compare, re-rendering every tool block on each
  // streaming frame. The adapter memoizes the object on the step's own fields.
  assert.match(source, /const MemoizedToolCall = memo\(function MemoizedToolCall/);
  assert.match(
    source,
    /const toolCallContent = useMemo<ToolCallContent>\(\(\) => \(\{[\s\S]*?\}\), \[block\.toolCallId, block\.toolName, block\.input\]\);/,
  );
  // No inline object literal may reach ToolCallBlock directly anymore.
  assert.doesNotMatch(source, /<ToolCallBlock\s+block=\{\{/);
});

test("S5: the summary button names its disclosure region with aria-controls", () => {
  // The region id and the button's aria-controls must come from the same
  // useId() value, and the reference may only be emitted while the region is
  // actually mounted (the collapsed branch is unmounted, so a permanent
  // aria-controls would be a dangling IDREF).
  assert.match(source, /const detailsId = useId\(\);/);
  assert.match(source, /import \{[^}]*\buseId\b[^}]*\} from "react";/);
  assert.match(source, /aria-controls=\{areaExpanded \? detailsId : undefined\}/);
  assert.match(source, /\{areaExpanded && \(\s*<div id=\{detailsId\} className="overflow-hidden">/);
  // Exactly one aria-controls, wired to detailsId; aria-expanded still carries
  // the collapsed state so the announcement does not depend on the reference.
  assert.equal((source.match(/aria-controls=/g) ?? []).length, 1);
  assert.equal((source.match(/id=\{detailsId\}/g) ?? []).length, 1);
  assert.match(source, /aria-expanded=\{areaExpanded\}/);
});

test("S5: keyboard focus reveals the affordances that hover alone used to reveal", () => {
  // The display-mode toggle sat at opacity-0 + pointer-events-none and was only
  // lifted by group-hover, so a keyboard user could Tab onto an invisible,
  // unhittable control. Focus must reveal it the same way hover does.
  // Grab the toggle's own className template literal (the one that carries the
  // hover reveal) rather than any text before it.
  const revealClass = source.match(/className=\{`([^`]*group-hover\/summary-row:opacity-100[^`]*)`\}/);
  assert.ok(revealClass, "the display-mode toggle must carry a className with the hover reveal");
  const classes = revealClass[1];
  for (const required of [
    "group-hover/summary-row:opacity-100",
    "group-focus-within/summary-row:opacity-100",
    "group-hover/summary-row:pointer-events-auto",
    "group-focus-within/summary-row:pointer-events-auto",
    "focus-visible:opacity-100",
    "focus-visible:pointer-events-auto",
  ]) {
    assert.ok(classes.includes(required), "mode toggle must reveal on focus: " + required);
  }
  // The focus ring is drawn with Tailwind utilities only: no new CSS file, no
  // !important, no new custom property.
  assert.match(classes, /focus-visible:outline-2/);
  assert.doesNotMatch(classes, /!/, "no !important utilities may be introduced");
  // The caret inside the summary button follows the same rule via its own group.
  assert.match(source, /group-hover\/summary:opacity-60 group-focus-visible\/summary:opacity-60/);
});
