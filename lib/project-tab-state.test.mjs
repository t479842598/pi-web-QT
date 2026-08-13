import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  getProjectTabState,
  getProjectTabStatePath,
  updateProjectTabState,
  MAX_PROJECT_TABS,
} = await createJiti(import.meta.url).import("./project-tab-state.ts");

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-project-tab-state-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, agentDir };
}

test("missing file reads as an empty state", async (t) => {
  const { agentDir } = await createFixture(t);
  assert.deepEqual(getProjectTabState(agentDir), { tabs: [], pinnedProject: null });
});

test("update round-trips through the JSON file and prunes missing dirs", async (t) => {
  const { root, agentDir } = await createFixture(t);
  const a = join(root, "a");
  const b = join(root, "b");
  await mkdir(a);
  await mkdir(b);

  const state = updateProjectTabState(agentDir, {
    tabs: [a, b, join(root, "missing")],
    pinnedProject: a,
  });
  assert.deepEqual(state, { tabs: [a, b], pinnedProject: a });

  const reRead = getProjectTabState(agentDir);
  assert.deepEqual(reRead, { tabs: [a, b], pinnedProject: a });
  assert.equal((await readFile(getProjectTabStatePath(agentDir), "utf8")).includes(join(root, "missing")), false);
});

test("field-level merge: a tabs-only update preserves the pinned project and vice versa", async (t) => {
  const { root, agentDir } = await createFixture(t);
  const a = join(root, "a");
  const b = join(root, "b");
  await mkdir(a);
  await mkdir(b);

  updateProjectTabState(agentDir, { tabs: [a, b], pinnedProject: a });

  // tabs-only update keeps the pin
  assert.deepEqual(updateProjectTabState(agentDir, { tabs: [b] }), { tabs: [b], pinnedProject: a });
  // pin-only update keeps the tabs
  assert.deepEqual(updateProjectTabState(agentDir, { pinnedProject: b }), { tabs: [b], pinnedProject: b });
  // clearing the pin keeps the tabs
  assert.deepEqual(updateProjectTabState(agentDir, { pinnedProject: null }), { tabs: [b], pinnedProject: null });
});

test("tabs are capped at MAX_PROJECT_TABS and deduplicated", async (t) => {
  const { root, agentDir } = await createFixture(t);
  const many = [];
  for (let i = 0; i < 10; i++) {
    const p = join(root, `proj-${i}`);
    await mkdir(p, { recursive: true });
    many.push(p);
  }

  const state = updateProjectTabState(agentDir, { tabs: [...many, many[0]] });
  assert.equal(state.tabs.length, MAX_PROJECT_TABS);
  assert.equal(new Set(state.tabs).size, state.tabs.length);
});

test("a pinned project whose directory disappears is dropped on read", async (t) => {
  const { root, agentDir } = await createFixture(t);
  const a = join(root, "a");
  const gone = join(root, "gone");
  await mkdir(a);
  await mkdir(gone);

  updateProjectTabState(agentDir, { tabs: [a, gone], pinnedProject: gone });
  await rm(gone, { recursive: true, force: true });

  const state = getProjectTabState(agentDir);
  assert.deepEqual(state, { tabs: [a], pinnedProject: null });
});

test("corrupt JSON falls back to an empty state", async (t) => {
  const { agentDir } = await createFixture(t);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(getProjectTabStatePath(agentDir), "{ not json !!");
  assert.deepEqual(getProjectTabState(agentDir), { tabs: [], pinnedProject: null });
});
