import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

// The trunk implementation renders the scroll-to-latest button through the
// composer's top-center slot (`topCenterControl`): the old bottom-right pill
// collided with the streaming steer/queue panel floating over the same corner.
// The flag itself still lives in the session hook, derived from the shared
// shouldShowScrollToLatest helper.

function topCenterBlock() {
  const start = source.indexOf("topCenterControl={showScrollToBottom");
  assert.notEqual(start, -1, "topCenterControl scroll-to-latest button not found");
  const buttonStart = source.indexOf("<button", start);
  const buttonEnd = source.indexOf("</button>", start);
  assert.notEqual(buttonStart, -1);
  assert.notEqual(buttonEnd, -1);
  assert.ok(buttonStart < start + 400, "button is the topCenterControl payload");
  return source.slice(buttonStart, buttonEnd);
}

test("shows the scroll-to-latest button only when the viewport is detached from the tail", () => {
  // The button is mounted only while the hook's detached-tail flag is on.
  assert.match(
    source,
    /topCenterControl=\{showScrollToBottom \? \(/,
    "visibility must be gated on the hook's detached-tail flag",
  );
  // The flag is derived from the shared tolerance helper, not a bare
  // scroll-position read.
  assert.match(
    hookSource,
    /const shouldShow = shouldShowScrollToLatest\(scrollTop, clientHeight, scrollHeight\);/,
  );
});

test("floats the scroll-to-latest button over the composer's top border, clear of streaming actions", () => {
  // The composer slot straddles the top border; the streaming overlay/actions
  // stay siblings inside the same shell, so a midline button cannot cover them.
  assert.match(chatInputSource, /topCenterControl\?: React\.ReactNode;/);
  assert.match(chatInputSource, /\{topCenterControl\}/);
  const slot = cssSource.slice(cssSource.indexOf(".chat-input-shell > .chat-input-top-center {"));
  const block = slot.slice(0, slot.indexOf("}"));
  assert.match(block, /position: absolute;/);
  assert.match(block, /top: 0;/);
  assert.match(block, /transform: translate\(-50%, -50%\);/);
  assert.match(block, /z-index: 3;/);
  // Hover affordance lives in the same slot rule set.
  assert.match(cssSource, /\.chat-input-shell > \.chat-input-top-center:hover \{[\s\S]*?border-color: var\(--accent\)/);
  // Touch targets grow in the mobile media query instead of a fixed offset.
  assert.match(cssSource, /\.chat-input-shell > \.chat-input-top-center \{[\s\S]*?\}[\s\S]*?width: 44px;/);
  const trigger = topCenterBlock();
  assert.match(trigger, /onClick=\{scrollToBottomAfterProcessExpansion\}/);
});

test("keeps the button labeled and icon-only", () => {
  const trigger = topCenterBlock();
  assert.match(trigger, /title=\{t\("desktop\.scrollToBottom"\)\}/);
  assert.match(trigger, /aria-label=\{t\("desktop\.scrollToBottom"\)\}/);
  assert.match(trigger, /aria-hidden="true"/);
  // "Scroll to latest" is the same string in both message catalogs.
  assert.match(source, /import \{ ArrowDownIcon \} from "@phosphor-icons\/react\/ArrowDown";/);
});

test("lands the tail with keep-out room and a settle re-scroll", () => {
  // The shared helper scrolls with a live composer measurement and a delayed
  // correction because virtual-list rows measure after mount.
  assert.match(
    hookSource,
    /const scrollToBottom = useCallback\(\(behavior: ScrollBehavior = "smooth"\) => \{/,
  );
  assert.match(hookSource, /const keepOut = Math\.max\(BOTTOM_KEEP_OUT_PX, composerHeight\);/);
  assert.match(hookSource, /container\.scrollTo\(\{ top: target, behavior \}\);/);
  assert.match(
    hookSource,
    /if \(behavior === "instant" \|\| behavior === "auto"\) \{[\s\S]*?\}, 200\);/,
  );
});

test("exposes the detached-tail flag from the session hook without a ref read", () => {
  assert.match(hookSource, /const \[showScrollToBottom, setShowScrollToBottom\] = useState\(false\)/);
  assert.match(
    hookSource,
    /const shouldShow = shouldShowScrollToLatest\(scrollTop, clientHeight, scrollHeight\);\s*setShowScrollToBottom\(\(previous\) => \(previous === shouldShow \? previous : shouldShow\)\);/,
  );
  assert.match(hookSource, /promptAnchorActive,/);
});
