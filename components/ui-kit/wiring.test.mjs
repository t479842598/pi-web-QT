import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Slot wiring lock.
 *
 * The registry can list 26 implementations and still render none of them: a slot
 * only exists once some component actually calls `useSlot` for it. That gap is
 * invisible in screenshots when the dev server requires a login, so it is
 * asserted from the source instead — every slot must have at least one live
 * consumer outside the kit layer.
 */

const ROOT = new URL("../../", import.meta.url);

function read(relative) {
  return readFileSync(new URL(relative, ROOT), "utf8");
}

const consumers = [
  "components/conversation-render-proxy.tsx",
  "components/shell-render-proxy.tsx",
  "components/session-row-render-proxy.tsx",
  "components/ui-kit/primitives.tsx",
].map(read).join("\n");

/**
 * Slots whose Claude side is not a drop-in proxy.
 *
 * `composer` is the only one: `ClaudeComposerChrome` takes four ReactNode slots
 * (leading / editor / trailing / footer) that `ChatInput`'s prop contract does
 * not carry, so binding the slot renders an empty shell. The Claude look for the
 * composer comes from the chin rules in app/settings-claude.css instead. Listed
 * here so the "has a live consumer" assertion stays honest rather than being
 * loosened.
 */
export const CSS_ONLY = ["composer"];

/** Slots that are wired through a proxy module or the primitive facade. */
const WIRED = [
  // conversation
  "messageList", "messageShell", "thinking", "toolCard", "subagentRow", "subagentPanel",
  // shell (composer is CSS-only, see CSS_ONLY)
  "titleBar", "sidebar", "sessionRow", "tabBar", "modelSwitcher", "fileViewer",
  // overlay
  "dialogShell", "palette", "approvalCard", "planReview", "trustDialog", "queueRecovery", "imageLightbox",
  // conversation (compaction lives with the transcript)
  "compaction",
  // primitives (through the facade)
  "button", "segmented", "toggle", "status", "field",
];

for (const slot of WIRED) {
  test(`slot "${slot}" has a live consumer`, () => {
    const pattern = new RegExp(`useSlot\\(["']${slot}["']\\)|makeProxy\\(["']${slot}["']|usePrimitive<[^>]*>\\(["']${slot}["']\\)`);
    assert.match(consumers, pattern, `no component asks for the "${slot}" slot`);
  });
}

test("each proxy export is consumed by something outside the kit layer", () => {
  // The slot helper only proves *a proxy* mentions the slot. It cannot tell
  // whether any component renders that proxy, which is how `thinking` stayed
  // dead while every assertion passed: ThinkingRow existed and nothing imported
  // it. This walks the proxy modules' own exports instead.
  const proxy = read("components/conversation-render-proxy.tsx");
  const shell = read("components/shell-render-proxy.tsx");
  const rowProxy = read("components/session-row-render-proxy.tsx");
  const exported = [
    ...proxy.matchAll(/export function (\w+)/g),
    ...shell.matchAll(/export const (\w+)/g),
    ...rowProxy.matchAll(/export function (\w+)/g),
  ].map((match) => match[1]);

  assert.ok(exported.length >= 13, `expected the proxies to export their rows, saw ${exported.length}`);

  const callers = [
    "components/AppShell.tsx",
    "components/ChatWindow.tsx",
    "components/MessageView.tsx",
    "components/SessionSidebar.tsx",
    "components/AgentsConfig.tsx",
    "components/model-config/DefaultModelRow.tsx",
  ]
    .map((file) => {
      try {
        return read(file);
      } catch {
        return "";
      }
    })
    .join("\n");

  const unrendered = exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(callers));
  assert.deepEqual(unrendered, [], "a proxy is exported but no component renders it");
});

test("every registry slot is in the wired list", () => {
  const uiKit = read("lib/ui-kit.ts");
  const declared = [...uiKit.matchAll(/^\s{2}"([a-zA-Z]+)",\s*$/gm)].map((m) => m[1]);
  assert.equal(declared.length, 26, "26 switchable surfaces");
  const missing = declared.filter(
    (slot) => !WIRED.includes(slot) && !CSS_ONLY.includes(slot),
  );
  assert.deepEqual(missing, [], "a slot exists in the model but no component renders it");
  // No exemption list any more: `sessionRow` was the last slot without a mount
  // point and is now rendered through session-row-render-proxy.tsx, so every
  // declared slot must be in WIRED or CSS_ONLY. Deleting an entry from WIRED
  // therefore has to fail here, not be excused.
  assert.deepEqual(declared.filter((slot) => !WIRED.includes(slot)), ["composer"]);
});

test("the two kits are distinguishable in markup", () => {
  // Each Claude surface carries a class the pi tree never emits, so a screenshot
  // can prove which kit rendered without diffing pixels.
  const markers = [
    ["components/claude/shell/ClaudeTabBar.tsx", "claude-tab-bar"],
    ["components/claude/shell/ClaudeSidebar.tsx", "claude-sidebar"],
    ["components/claude/overlay/ClaudeApprovalCard.tsx", "cds-approval"],
    ["components/claude/conversation/ClaudeMessageList.tsx", "data-index"],
    ["components/claude/shell/ClaudeSessionRow.tsx", "claude-session-row"],
  ];
  for (const [file, marker] of markers) {
    assert.match(read(file), new RegExp(marker), `${file} must expose "${marker}"`);
  }
  const piTabBar = read("components/TabBar.tsx");
  assert.doesNotMatch(piTabBar, /claude-tab-bar/, "the pi tree must not emit the claude marker");
  // The session row is the same rule: the pi adapter emits the shared
  // `session-row` hooks and never the Claude marker.
  const piRow = read("components/ui-kit/pi/SessionRow.tsx");
  assert.doesNotMatch(piRow, /claude-session-row/, "the pi row must not emit the claude marker");
});
