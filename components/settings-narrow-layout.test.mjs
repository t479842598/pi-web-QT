import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Narrow-viewport regressions found while auditing the 0.18.19 release.
 *
 * Each of these is an element whose intrinsic width is wider than a phone
 * column and which therefore widened its card (and the page) instead of
 * wrapping or scrolling. They are asserted at the source level because the
 * fix is a specific pair of declarations: `minWidth: 0` (so a flex/grid item
 * may shrink below its content) plus either wrapping or a local scroller.
 */

const read = (name) => readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8");

test("a settings note wraps inside its card instead of widening it", async () => {
  const source = await read("SettingCard");
  const note = source.slice(source.indexOf("export function SettingNote"));
  assert.match(note, /minWidth: 0/);
  assert.match(note, /overflowWrap: "anywhere"/);
});

test("a long model id truncates instead of overflowing its row", async () => {
  const source = await read("ModelsConfig");
  // The per-model row inside a custom provider's list.
  const at = source.indexOf('fontFamily: "var(--font-mono)", color: m.id');
  assert.ok(at > 0, "the model-row span is still rendered");
  const lineStart = source.lastIndexOf("<span", at);
  const lineEnd = source.indexOf("\n", source.indexOf(">", at));
  const span = source.slice(lineStart, lineEnd);
  assert.match(span, /display: "block"/, "an inline span ignores overflow/text-overflow");
  assert.match(span, /maxWidth: "100%"/);
  assert.match(span, /textOverflow: "ellipsis"/);
});

test("the proxy form collapses to one column on narrow screens", async () => {
  const source = await read("ProxyConfig");
  assert.match(source, /gridTemplateColumns: "repeat\(auto-fit, minmax\(min\(220px, 100%\), 1fr\)\)"/);
  assert.doesNotMatch(source, /gridTemplateColumns: "1fr 1fr"/);
});

test("the usage bar strip scrolls inside its card", async () => {
  const source = await read("UsageConfig");
  const at = source.indexOf("overflowX: \"auto\"");
  assert.ok(at > 0, "the daily bar strip is still rendered");
  const strip = source.slice(Math.max(0, at - 300), at + 60);
  assert.match(strip, /minWidth: 0/);
  assert.match(strip, /maxWidth: "100%"/);
  assert.match(strip, /overflowX: "auto"/);
});

test("a preset whose name is already taken opens with a free name", async () => {
  const source = await read("model-config/ProviderSetupSheet");
  assert.match(source, /function uniqueProviderName/);
  assert.match(source, /uniqueProviderName\(presetSlug\(preset\), existingProviderNames\)/);
  // The red duplicate line is reserved for a name the user typed.
  assert.match(source, /const nameTouched = name !== seededNameRef\.current/);
  assert.match(source, /duplicateName = !editing && nameTouched/);
});

test("the default-model row can wrap a long model id", async () => {
  const source = await read("model-config/DefaultModelRow");
  assert.match(source, /overflowWrap: "anywhere"/);
  assert.match(source, /minWidth: 0/);
});
