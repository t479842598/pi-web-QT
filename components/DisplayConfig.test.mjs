// D11 — the theme grid offers exactly one way to reach the default theme.
//
// The "Default" card used to sit beside the Claude card and call
// setTheme(""), which deleted pi-theme and let app/layout.tsx's inline
// bootstrap re-materialise claude on the next reload. Two cards, two paths,
// one end state — and nothing said which one was the truth. The card is gone;
// DEFAULT_THEME in hooks/useTheme.ts is now the only definition (see
// useTheme.test.mjs). These assertions stop the second encoding from
// creeping back in through this panel.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as ts from "typescript";

const source = await readFile(new URL("./DisplayConfig.tsx", import.meta.url), "utf8");

async function jsxElements() {
  const ast = ts.createSourceFile("DisplayConfig", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0, "DisplayConfig parses as TSX");
  const found = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = Object.fromEntries(node.attributes.properties
        .filter(ts.isJsxAttribute)
        .map((attr) => [attr.name.text, attr.initializer?.getText(ast) ?? ""]));
      found.push({ tag: node.tagName.getText(ast), attributes });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return found;
}

test("no card selects the empty theme name", async () => {
  const found = await jsxElements();
  const cards = found.filter((el) => el.tag === "ThemeCard");
  assert.ok(cards.length >= 1, "the themeSets template still renders: " + cards.length);
  for (const card of cards) {
    const text = JSON.stringify(card.attributes);
    assert.ok(!text.includes('handleThemeChange("")'), "a ThemeCard must not select the empty name");
    assert.ok(!text.includes('themeName === ""'), "a ThemeCard must not mark the empty name active");
  }
  assert.doesNotMatch(source, /"__default__"/, "the synthetic default hover tag is gone");
});

test("the default card's dead support code is gone", () => {
  assert.doesNotMatch(source, /defaultPreview/, "no defaultPreview state or prop survives");
  assert.doesNotMatch(source, /setDefaultPreview/, "the fetch handler no longer stores a default preview");
  assert.doesNotMatch(source, /desktop\.defaultTheme/, "the i18n key it consumed is no longer referenced");
});

test("theme cards come only from the server's theme sets", async () => {
  const found = await jsxElements();
  const cards = found.filter((el) => el.tag === "ThemeCard");
  const mapped = cards.filter((el) => el.attributes.key === "{ts.name}");
  assert.equal(mapped.length, 1, "exactly one ThemeCard is the themeSets template");
  assert.equal(cards.length, mapped.length, "every card is a themeSet card — no hand-written extra");
});

test("the grid still renders the theme picker it always did", async () => {
  const found = await jsxElements();
  assert.ok(found.some((el) => el.tag === "div" && el.attributes.className?.includes("settings-content-panel")),
    "panel root hook intact");
  assert.match(source, /\/api\/themes\?mode=/, "theme list still fetched per mode");
  assert.match(source, /setTheme/, "cards still switch themes");
});
