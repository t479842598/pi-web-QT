import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { getProjectAliases, getProjectAliasesPath, setProjectAlias } = await createJiti(import.meta.url).import("./project-aliases.ts");

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-project-aliases-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, agentDir };
}

test("missing file reads as an empty map", async (t) => {
  const { agentDir } = await createFixture(t);
  assert.deepEqual(getProjectAliases(agentDir), {});
});

test("set / update / remove round-trips through the JSON file", async (t) => {
  const { agentDir } = await createFixture(t);
  const cwd = "/some/project";

  setProjectAlias(agentDir, cwd, "  我的项目  ");
  assert.deepEqual(getProjectAliases(agentDir), { "/some/project": "我的项目" });

  setProjectAlias(agentDir, cwd, "new name");
  assert.deepEqual(getProjectAliases(agentDir), { "/some/project": "new name" });

  setProjectAlias(agentDir, cwd, "   ");
  assert.deepEqual(getProjectAliases(agentDir), {});
  assert.equal(existsSync(getProjectAliasesPath(agentDir)), true);
});

test("keys are resolved to absolute paths and the file is written privately", async (t) => {
  const { agentDir } = await createFixture(t);
  setProjectAlias(agentDir, "relative/project", "rel");
  const raw = JSON.parse(await readFile(getProjectAliasesPath(agentDir), "utf8"));
  const key = Object.keys(raw)[0];
  assert.equal(key.startsWith("/"), true);
  assert.equal(raw[key], "rel");
});

test("corrupt file reads as an empty map and still survives a write", async (t) => {
  const { agentDir } = await createFixture(t);
  await writeFile(join(agentDir, "project-aliases.json"), "{oops");
  assert.deepEqual(getProjectAliases(agentDir), {});
  setProjectAlias(agentDir, "/x", "ok");
  assert.deepEqual(getProjectAliases(agentDir), { "/x": "ok" });
});
