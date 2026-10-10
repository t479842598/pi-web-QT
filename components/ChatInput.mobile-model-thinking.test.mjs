import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const modelControl = source.slice(
  source.indexOf("{modelOptions.length > 0 && onModelChange && ("),
  source.indexOf("{modelDropdownOpen && modelDropdownRect &&"),
);
const thinkingControl = source.slice(
  source.indexOf("{onThinkingLevelChange && ("),
  source.indexOf("{thinkingDropdownOpen && thinkingDropdownRect &&"),
);

test("the model trigger shows a truncated name on phones, not just the icon", () => {
  // The visible name is no longer gated behind !isMobile.
  assert.match(modelControl, /truncateModelLabel\(currentName \?\? t\("desktop\.selectModel"\)\)/);
  assert.doesNotMatch(modelControl, /\{!isMobile && \(\s*<span/);
  // The provider icon and the caret stay on every viewport.
  assert.match(modelControl, /<ProviderIcon id=\{model\?\.provider/);
  assert.match(modelControl, /<CaretDownIcon/);
});

test("the model trigger keeps the full name in its title and aria-label", () => {
  assert.match(modelControl, /title=\{currentName \?\? t\("desktop\.selectModel"\)\}/);
  assert.match(modelControl, /aria-label=\{currentName \?\? t\("desktop\.selectModel"\)\}/);
  // A capped, single-line width keeps a long name from wrapping the row.
  assert.match(modelControl, /maxWidth: isMobile \? "min\(132px, 40vw\)"/);
});

test("the thinking trigger shows its level label at every width", () => {
  assert.doesNotMatch(thinkingControl, /\{!isMobile && \(\s*<span[^>]*>\{thinkingDisplayLabel\}/);
  assert.match(thinkingControl, /\{thinkingDisplayLabel\}<\/span>/);
  assert.match(thinkingControl, /<ThinkingLevelIcon level=\{thinkingLevel \?\? "auto"\}/);
  assert.match(thinkingControl, /maxWidth: isMobile \? "min\(104px, 32vw\)"/);
});
