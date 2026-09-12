import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ApprovalModal.tsx", import.meta.url), "utf8");

test("offers ZCode's four numbered options with a scope label", () => {
  for (const key of ["allowOnce", "allowAlways", "denyOnce", "denyAlways"]) {
    assert.match(source, new RegExp(`key: "${key}"`), `${key} option exists`);
  }
  // The visible numbering (ZCode: "1." "2." …) is rendered from the index.
  assert.match(source, /\{index \+ 1\}\./, "options are numbered");
  assert.match(source, /approval\.allowAlways/, "always-allow label");
  assert.match(source, /approval\.denyAlways/, "always-deny label");
});

test("supports ZCode's keyboard model: digits answer, arrows move, Enter confirms", () => {
  assert.match(source, /const digit = Number\(event\.key\)/);
  assert.match(source, /digit >= 1 && digit <= options\.length/);
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "Tab" && !event\.shiftKey/);
  assert.match(source, /event\.key === "Enter"/);
  // pi-web convention: Escape dismisses (ZCode has no Esc here).
  assert.match(source, /event\.key === "Escape"/);
});

test("always writes a scoped permission rule instead of the bare tool name", () => {
  assert.match(source, /extractSubject\(request\.toolName, request\.args\)/);
  assert.match(source, /`\$\{request\.toolName\}\(\$\{subject\}\)`/);
});

test("uses theme tokens rather than a hard-coded amber border", () => {
  assert.match(source, /var\(--accent-orange, #f59e0b\)/, "warning color goes through a token");
  assert.doesNotMatch(source, /border: "1px solid color-mix\(in srgb, #f59e0b/);
});
