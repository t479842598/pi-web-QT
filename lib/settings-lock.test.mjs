// Verify the locked settings write serializes concurrent mutations correctly.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

function isolateAgentDir() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-settings-lock-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  // proper-lockfile requires the target file to exist before locking it.
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultModel: "foo/bar" }));
  return agentDir;
}

test("locked settings write preserves unrelated keys", async () => {
  isolateAgentDir();
  const { mutateSettingsJson, readSettingsJsonUnlocked } = await jiti.import("./settings-lock.ts");
  await mutateSettingsJson((s) => { s.__lockTest = "x"; return { settings: s }; });
  const after = readSettingsJsonUnlocked();
  assert.equal(after.__lockTest, "x");
  await mutateSettingsJson((s) => { delete s.__lockTest; return { settings: s }; });
});

test("concurrent locked mutations both apply (no lost update)", async () => {
  isolateAgentDir();
  const { mutateSettingsJson, readSettingsJsonUnlocked } = await jiti.import("./settings-lock.ts");
  await Promise.all([
    mutateSettingsJson((s) => { s.__t1 = "1"; return { settings: s }; }),
    mutateSettingsJson((s) => { s.__t2 = "2"; return { settings: s }; }),
  ]);
  const final = readSettingsJsonUnlocked();
  assert.equal(final.__t1, "1");
  assert.equal(final.__t2, "2");
  await mutateSettingsJson((s) => { delete s.__t1; delete s.__t2; return { settings: s }; });
});
