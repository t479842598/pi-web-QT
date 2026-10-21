import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * pi session-row fidelity contract.
 *
 * The sessionRow slot moved the row's *box* out of SessionSidebar's inline
 * markup and into components/ui-kit/pi/SessionRow.tsx. The contract is that
 * nothing a browser can observe changes: same class string, same style
 * declarations in the same insertion order (React emits the style attribute in
 * that order), same data-* attributes, same handlers, same children.
 *
 * Two layers of proof:
 *   1. this file — the declarations are pinned verbatim against the pre-slot
 *      markup, so a dropped or reordered declaration fails `npm test`;
 *   2. work/row-geometry-probe.mjs — a real chromium compares class, style
 *      attribute, declaration order, data-*, child tags, text, bounding rect
 *      and 23 computed properties for HEAD vs the working tree in both sidebar
 *      views, and reported 0 differences.
 *
 * The strings below are copied from the pre-slot SessionSidebar (git HEAD),
 * not derived from the adapter, so the adapter cannot satisfy them by accident.
 */

const ROOT = new URL("../../", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, ROOT), "utf8");

const ADAPTER = read("components/ui-kit/pi/SessionRow.tsx");
const PROXY = read("components/session-row-render-proxy.tsx");
const SIDEBAR = read("components/SessionSidebar.tsx");
const CLAUDE_ROW = read("components/claude/shell/ClaudeSessionRow.tsx");

/** The tree row's inline declarations, verbatim as SessionSidebar wrote them. */
const TREE_DECLARATIONS = [
  'height: "var(--session-row-height, " + TREE_ITEM_HEIGHT + "px)"',
  'minHeight: "var(--session-row-height, " + TREE_ITEM_HEIGHT + "px)"',
  'display: "flex"',
  'alignItems: "center"',
  "paddingLeft: depth > 0 ? depth * 12 + 14 : 14",
  "paddingRight: 8",
  'cursor: inert ? "default" : "pointer"',
  "background: surface",
  "borderLeft: rail",
  'borderRadius: "var(--session-row-radius, 0)"',
  'transition: "background 0.1s"',
  "opacity: deleting ? 0.5 : 1",
  "gap: 6",
  'overflow: "hidden"',
];

/** The grouped row's inline declarations, verbatim as SessionCompactRow wrote them. */
const GROUP_DECLARATIONS = [
  'display: "flex", flexDirection: "column", justifyContent: "center"',
  'padding: "5px 8px 5px 10px"',
  "paddingLeft: 10 + depth * 14",
  'position: "relative"',
  'cursor: inert ? "default" : "pointer"',
  "background: surface",
  "borderLeft: rail",
  'borderRadius: "var(--session-row-radius, 6px)"',
  'transition: "background 0.1s"',
  "opacity: deleting ? 0.5 : 1",
];

/** Split the adapter at the variant branch: tree first, group second. */
function branches() {
  const at = ADAPTER.indexOf('if (variant === "tree")');
  assert.ok(at > 0, "the adapter separates the two sidebar views");
  // The group return is the only one indented by exactly two spaces.
  const end = ADAPTER.indexOf("\n  return (", at);
  assert.ok(end > at, "the group branch follows the tree branch");
  return { tree: ADAPTER.slice(at, end), group: ADAPTER.slice(end) };
}

const BRANCHES = branches();

for (const [label, declarations, branch] of [
  ["tree", TREE_DECLARATIONS, BRANCHES.tree],
  ["group", GROUP_DECLARATIONS, BRANCHES.group],
]) {
  test(`pi ${label} row keeps every inline declaration, in order`, () => {
    const positions = declarations.map((text) => {
      const at = branch.indexOf(text);
      assert.ok(at >= 0, `pi ${label} row lost a declaration: ${text}`);
      return at;
    });
    assert.deepEqual(
      positions.slice(),
      positions.slice().sort((a, b) => a - b),
      `pi ${label} row reordered its declarations, which changes the style attribute`,
    );
  });
}

test("the tree row height still comes from the 50px the sidebar measured", () => {
  assert.match(ADAPTER, /const TREE_ITEM_HEIGHT = 50;/, "50px is the list's own constant");
  // The old markup concatenated the number, so the fallback is "50px" — a
  // template literal that produced "50 px" or a plain 50 would differ.
  assert.match(ADAPTER, /"var\(--session-row-height, " \+ TREE_ITEM_HEIGHT \+ "px\)"/);
});

test("the selected surface keeps the pre-slot condition", () => {
  // Old markup: `confirmDelete || isSelected`. confirmDelete maps to `armed`;
  // a rename must NOT paint the selected surface, which is why `inert` and
  // `armed` are separate props rather than one flag.
  assert.match(ADAPTER, /const lit = Boolean\(armed\) \|\| selected;/);
  assert.doesNotMatch(ADAPTER, /const lit = Boolean\(inert\)/, "inert covers renaming too");
  assert.match(SIDEBAR, /armed=\{confirmDelete\}/);
  assert.match(SIDEBAR, /inert=\{confirmDelete \|\| renaming\}/);
});

test("the class string and data-fork-depth are unchanged", () => {
  for (const token of ['"session-row"', 'selected ? "is-selected"', 'running ? "is-running"',
    'unread ? "is-unread"', 'depth > 0 ? "is-fork"']) {
    assert.ok(ADAPTER.includes(token), `pi row lost a class hook: ${token}`);
  }
  assert.match(ADAPTER, /data-fork-depth=\{depth\}/);
  // No kit-specific marker may leak into the pi row, or the Claude stylesheet
  // would restyle it under kit=pi.
  assert.doesNotMatch(ADAPTER, /claude/, "the pi adapter must not emit a claude hook");
});

test("the hover handlers, click suppression and ref all stay with the sidebar", () => {
  assert.match(ADAPTER, /onClick=\{inert \? undefined : onSelect\}/);
  assert.match(ADAPTER, /onMouseEnter=\{onMouseEnter\}/);
  assert.match(ADAPTER, /onMouseLeave=\{onMouseLeave\}/);
  assert.match(ADAPTER, /ref=\{containerRef\}/);
  // The sidebar still owns them: hover state, rename, archive, fork tooltip.
  assert.match(SIDEBAR, /onMouseEnter=\{\(\) => setHovered\(true\)\}/);
  assert.match(SIDEBAR, /setHovered\(false\); setForkTooltip\(false\)/);
  assert.match(SIDEBAR, /containerRef=\{rowRef\}/);
});

test("both sidebar row sites render through the slot", () => {
  const opens = [...SIDEBAR.matchAll(/<SessionRowShell\s*\n\s*variant="(tree|group)"/g)].map((m) => m[1]);
  assert.deepEqual(opens, ["tree", "group"], "list view and grouped view are both wired");
  assert.equal((SIDEBAR.match(/<\/SessionRowShell>/g) ?? []).length, 2);
  // The row content never moved: the sidebar still renders the children.
  assert.match(SIDEBAR, /desktop\.archiveSessionConfirm/);
  assert.match(SIDEBAR, /accordion-row-in/);
  assert.match(SIDEBAR, /desktop\.forkedFrom/);
});

test("the proxy renders the pi adapter directly, with no wrapper node", () => {
  // A wrapper div would change the DOM the pi kit produces.
  assert.match(PROXY, /if \(!Impl \|\| Impl === PiSessionRow\) return <PiSessionRow \{\...props\} \/>/);
  // The marker element must come after the early return, i.e. only on the
  // non-pi path (the word also appears in the doc comment above).
  const markerElement = PROXY.indexOf('className="claude-surface-root"');
  assert.ok(
    markerElement > PROXY.indexOf("if (!Impl || Impl === PiSessionRow)"),
    "the Claude marker is only emitted for a non-pi implementation",
  );
  assert.match(PROXY, /useSlot\("sessionRow"\)/);
});

test("the claude row keeps the shared hooks and adds its own marker", () => {
  for (const token of ['"session-row"', 'selected ? "is-selected"', 'depth > 0 ? "is-fork"', "claude-session-row"]) {
    assert.ok(CLAUDE_ROW.includes(token), `claude row lost ${token}`);
  }
  assert.match(CLAUDE_ROW, /data-active=/, "the Claude stylesheet keys the selected state off data-active");
});
