import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const globals = await readFile(new URL("./globals.css", import.meta.url), "utf8");
const settings = await readFile(new URL("./settings.css", import.meta.url), "utf8");
const settingsClaude = await readFile(new URL("./settings-claude.css", import.meta.url), "utf8");

// Minimal extractor: every top-level or nested rule whose selector list contains
// the needle, returned in source order with the enclosing at-rule conditions.
function rules(css, needle) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = [];
  const stack = [];
  let buffer = "";
  let index = 0;
  while (index < clean.length) {
    const char = clean[index];
    if (char === "{") {
      const prelude = buffer.trim();
      buffer = "";
      if (prelude.startsWith("@")) {
        stack.push(prelude);
        index += 1;
        continue;
      }
      let depth = 1;
      let cursor = index + 1;
      let body = "";
      while (cursor < clean.length && depth > 0) {
        if (clean[cursor] === "{") depth += 1;
        else if (clean[cursor] === "}") { depth -= 1; if (depth === 0) break; }
        body += clean[cursor];
        cursor += 1;
      }
      if (prelude.split(",").some((part) => part.trim().includes(needle))) {
        found.push({ selector: prelude.trim(), body, conditions: stack.slice() });
      }
      index = cursor + 1;
      continue;
    }
    if (char === "}") {
      buffer = "";
      stack.pop();
      index += 1;
      continue;
    }
    buffer += char;
    index += 1;
  }
  return found;
}

function declarations(body) {
  return body
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf(":");
      return { property: entry.slice(0, at).trim(), value: entry.slice(at + 1).trim() };
    });
}

test("catppuccin icons keep the single-colour mask as the winning cascade", () => {
  const iconRules = rules(globals, ".catppuccin-file-icon");
  const masked = iconRules.filter((rule) => rule.conditions.some((condition) => condition.includes("@supports")));
  const unmasked = iconRules.filter((rule) => rule.conditions.length === 0);

  // Two rules outside @supports: the plain fallback pair (.catppuccin-file-icon and
  // html.dark .catppuccin-file-icon). A third one placed after the @supports block
  // is what used to re-declare background and paint the coloured SVG on top.
  assert.equal(unmasked.length, 2, "exactly the two fallback rules may live outside @supports");
  assert.ok(
    unmasked.every((rule) => rule.conditions.length === 0 && iconRules.indexOf(rule) < iconRules.indexOf(masked[0])),
    "fallback rules must precede the @supports block, otherwise they win the cascade",
  );

  // The mask block must still paint a flat palette colour and mask by alpha.
  const dimColor = masked.filter((rule) =>
    declarations(rule.body).some((declaration) => declaration.property === "background" && declaration.value === "var(--text-dim)"));
  assert.equal(dimColor.length, 2, "light and dark both paint var(--text-dim) before masking");
  const maskImage = masked.flatMap((rule) => declarations(rule.body))
    .filter((declaration) => declaration.property === "mask-image" || declaration.property === "mask");
  assert.ok(maskImage.length >= 2, "mask reference must stay per theme");
  assert.ok(
    maskImage.every((declaration) => declaration.value.includes("var(--catppuccin-icon-")),
    "the mask reads the per-icon URL, never a literal path",
  );
});

test("agents concurrency control is declared once", () => {
  const control = rules(settings, "agents-concurrency-control");
  assert.equal(control.length, 2, "one rule for the label and one for the input");
  const seen = new Set();
  for (const rule of control) {
    const key = rule.selector + "|" + declarations(rule.body).map((d) => d.property + ":" + d.value).join(";");
    assert.ok(!seen.has(key), "duplicate block: " + rule.selector);
    seen.add(key);
  }
});

test("the composer toolbar declares each order once", () => {
  const selectors = ["chat-input-toolbar-model", "chat-input-toolbar-thinking", "chat-input-toolbar-tools", "chat-input-send"];
  for (const selector of selectors) {
    const orderRules = rules(settingsClaude, selector)
      .filter((rule) => declarations(rule.body).some((declaration) => declaration.property === "order"));
    // .chat-input-send also carries the stop button in one shared rule, so the
    // selector list means at most one rule may declare order.
    assert.equal(orderRules.length, 1, selector + " declares order " + orderRules.length + " times");
  }
});
