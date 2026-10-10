import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The module now imports ./regular-file without an extension, which Node's
// strip-types loader cannot resolve; jiti resolves it the way Next does.
async function loadSubject() {
  return createJiti(import.meta.url).import("./http-dispatcher.ts");
}

test("reads httpIdleTimeoutMs from the agent settings file", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-http-idle-"));
  const settingsPath = join(agentDir, "settings.json");
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));

  const { readHttpIdleTimeoutMs } = await loadSubject();

  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "no settings file keeps the default");

  writeFileSync(settingsPath, "{ not json");
  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "unparsable settings keep the default");

  writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "a settings file without the key keeps the default");

  writeFileSync(settingsPath, JSON.stringify({ httpIdleTimeoutMs: -1 }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "a value the CLI rejects keeps the default");

  writeFileSync(settingsPath, JSON.stringify({ httpIdleTimeoutMs: null }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "a null value keeps the default");

  writeFileSync(settingsPath, JSON.stringify(["httpIdleTimeoutMs"]));
  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "settings that are not an object keep the default");

  writeFileSync(settingsPath, JSON.stringify({ httpIdleTimeoutMs: 1_200_000 }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), 1_200_000, "the configured timeout is used");

  writeFileSync(settingsPath, JSON.stringify({ httpIdleTimeoutMs: 0 }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), 0, "0 disables the timeout");

  writeFileSync(settingsPath, JSON.stringify({ httpIdleTimeoutMs: "disabled" }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), 0, "the CLI's disabled spelling disables the timeout");

  writeFileSync(settingsPath, `\ufeff${JSON.stringify({ httpIdleTimeoutMs: 900_000 })}`);
  assert.equal(readHttpIdleTimeoutMs(agentDir), 900_000, "a byte-order mark is tolerated");
});

test("parses bounded HTTP timeout values", async () => {
  const { parseHttpIdleTimeoutMs } = await loadSubject();

  assert.equal(parseHttpIdleTimeoutMs(300_000), 300_000);
  assert.equal(parseHttpIdleTimeoutMs(" 250 "), 250);
  assert.equal(parseHttpIdleTimeoutMs("disabled"), 0);
  assert.equal(parseHttpIdleTimeoutMs(""), undefined);
  assert.equal(parseHttpIdleTimeoutMs(-1), undefined);
  assert.equal(parseHttpIdleTimeoutMs("invalid"), undefined);
  assert.equal(parseHttpIdleTimeoutMs(Infinity), undefined);
});
