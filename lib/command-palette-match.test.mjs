import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  commandPaletteShortcutLabel,
  highlightMatches,
  matchesAllTerms,
  resolveQueryScope,
  scopePrefix,
  stripScopePrefix,
} = await createJiti(import.meta.url).import("./command-palette-match.ts");

test("resolveQueryScope maps the three prefixes and strips them from the query", () => {
  assert.deepEqual(resolveQueryScope("> new task", "all"), { scope: "commands", query: "new task" });
  assert.deepEqual(resolveQueryScope("# auth bug", "all"), { scope: "sessions", query: "auth bug" });
  assert.deepEqual(resolveQueryScope("@components/App", "all"), { scope: "files", query: "components/App" });
});

test("resolveQueryScope keeps the fallback scope when no prefix is present", () => {
  assert.deepEqual(resolveQueryScope("auth bug", "files"), { scope: "files", query: "auth bug" });
  assert.deepEqual(resolveQueryScope("", "sessions"), { scope: "sessions", query: "" });
  // A bare prefix selects the scope and leaves nothing to search.
  assert.deepEqual(resolveQueryScope(">", "all"), { scope: "commands", query: "" });
});

test("scopePrefix is the inverse of resolveQueryScope for prefixed scopes", () => {
  assert.equal(scopePrefix("commands"), ">");
  assert.equal(scopePrefix("sessions"), "#");
  assert.equal(scopePrefix("files"), "@");
  assert.equal(scopePrefix("all"), "");
});

test("stripScopePrefix removes only a leading prefix", () => {
  assert.equal(stripScopePrefix("> hello"), "hello");
  assert.equal(stripScopePrefix("  @ file"), "file");
  assert.equal(stripScopePrefix("plain query"), "plain query");
  assert.equal(stripScopePrefix("#"), "");
});

test("highlightMatches marks every occurrence of every term", () => {
  assert.deepEqual(highlightMatches("abc", ""), [{ text: "abc", hit: false }]);
  assert.deepEqual(highlightMatches("abc", "zzz"), [{ text: "abc", hit: false }]);

  const single = highlightMatches("Hello World", "world");
  assert.deepEqual(single, [
    { text: "Hello ", hit: false },
    { text: "World", hit: true },
  ]);

  // Case-insensitive, and the original casing is preserved in the output.
  const cased = highlightMatches("Fix BUG", "bug");
  assert.deepEqual(cased, [
    { text: "Fix ", hit: false },
    { text: "BUG", hit: true },
  ]);
});

test("highlightMatches merges overlapping and adjacent ranges", () => {
  // "ab" and "bc" overlap on the "b"; the output must not nest or duplicate.
  const overlapping = highlightMatches("abc", "ab bc");
  assert.deepEqual(overlapping, [{ text: "abc", hit: true }]);

  const repeated = highlightMatches("aaa", "a");
  assert.deepEqual(repeated, [{ text: "aaa", hit: true }]);
});

test("highlightMatches requires every term to match (AND) and highlights each hit", () => {
  const segments = highlightMatches("fix the auth bug", "fix bug");
  assert.deepEqual(segments, [
    { text: "fix", hit: true },
    { text: " the auth ", hit: false },
    { text: "bug", hit: true },
  ]);
});

test("matchesAllTerms is the AND predicate behind the same rule", () => {
  assert.equal(matchesAllTerms("fix the auth bug", "fix bug"), true);
  assert.equal(matchesAllTerms("fix the auth bug", "fix missing"), false);
  assert.equal(matchesAllTerms("anything", ""), true);
  assert.equal(matchesAllTerms("Anything", "anything"), true);
});

test("commandPaletteShortcutLabel picks the platform glyph", () => {
  assert.equal(commandPaletteShortcutLabel(true), "⌘K");
  assert.equal(commandPaletteShortcutLabel(false), "Ctrl+K");
});
