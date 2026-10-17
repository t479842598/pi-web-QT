import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Slot wiring lock.
 *
 * The registry can list 27 implementations and still render none of them: a slot
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
  "components/ui-kit/primitives.tsx",
].map(read).join("\n");

/**
 * Slots with a live consumer. `sessionRow` is the one exception: the sidebar
 * renders its rows inline inside a 3.4k-line component, so a kit-aware row
 * would mean restructuring that loop. The slot and both implementations exist
 * (and `ClaudeSessionRow` is verified by `shell.test.mjs`), but nothing mounts
 * it yet — listing it here would be a lie, and the assertions below would stop
 * catching real regressions.
 */
export const NOT_YET_WIRED = ["sessionRow"];

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

/** Slots that are wired through a proxy module. */
const WIRED = [
  // conversation
  "messageList", "messageShell", "thinking", "toolCard", "subagentRow", "subagentPanel",
  // shell (composer is CSS-only, see CSS_ONLY)
  "titleBar", "sidebar", "tabBar", "modelSwitcher", "fileViewer",
  // overlay
  "dialogShell", "palette", "approvalCard", "planReview", "trustDialog", "queueRecovery", "imageLightbox",
  // conversation (compaction lives with the transcript)
  "compaction",
  // primitives (through the facade)
  "button", "segmented", "toggle", "status", "field", "scrollFade",
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
  // it. This walks the proxy module's own exports instead.
  const proxy = read("components/conversation-render-proxy.tsx");
  const shell = read("components/shell-render-proxy.tsx");
  const exported = [
    ...proxy.matchAll(/export function (\w+)/g),
    ...shell.matchAll(/export const (\w+)/g),
  ].map((match) => match[1]);

  assert.ok(exported.length >= 12, `expected the proxies to export their rows, saw ${exported.length}`);

  const callers = [
    "components/AppShell.tsx",
    "components/ChatWindow.tsx",
    "components/MessageView.tsx",
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
  assert.ok(declared.length >= 27, `expected 27 slots, saw ${declared.length}`);
  const missing = declared.filter(
    (slot) => !WIRED.includes(slot) && !NOT_YET_WIRED.includes(slot) && !CSS_ONLY.includes(slot),
  );
  assert.deepEqual(missing, [], "a slot exists in the model but no component renders it");
  // The pending list must stay exactly what is documented above, so finishing a
  // wiring job forces this line to change.
  const pending = declared.filter((slot) => NOT_YET_WIRED.includes(slot));
  assert.deepEqual(pending, ["sessionRow"]);
});

test("the two kits are distinguishable in markup", () => {
  // Each Claude surface carries a class the pi tree never emits, so a screenshot
  // can prove which kit rendered without diffing pixels.
  const markers = [
    ["components/claude/shell/ClaudeTabBar.tsx", "claude-tab-bar"],
    ["components/claude/shell/ClaudeSidebar.tsx", "claude-sidebar"],
    ["components/claude/overlay/ClaudeApprovalCard.tsx", "cds-approval"],
    ["components/claude/conversation/ClaudeMessageList.tsx", "data-index"],
  ];
  for (const [file, marker] of markers) {
    assert.match(read(file), new RegExp(marker), `${file} must expose "${marker}"`);
  }
  const piTabBar = read("components/TabBar.tsx");
  assert.doesNotMatch(piTabBar, /claude-tab-bar/, "the pi tree must not emit the claude marker");
});
