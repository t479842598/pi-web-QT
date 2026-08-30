import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const {
  getProjectVisibilityPath,
  readProjectVisibility,
  listHiddenProjects,
  hideProject,
  unhideProject,
} = await createJiti(import.meta.url).import("./project-visibility.ts");

function freshAgentDir() {
  return mkdtempSync(join(tmpdir(), "pi-web-vis-"));
}

test("hide/unhide round-trips a project", async () => {
  const dir = freshAgentDir();
  try {
    assert.deepEqual(listHiddenProjects(dir), []);
    await hideProject(dir, "/tmp/my-project", "my-project");
    const hidden = listHiddenProjects(dir);
    assert.equal(hidden.length, 1);
    assert.equal(hidden[0].path, "/tmp/my-project");
    assert.equal(hidden[0].name, "my-project");
    assert.ok(Date.parse(hidden[0].hiddenAt) > 0);

    await unhideProject(dir, "/tmp/my-project");
    assert.deepEqual(listHiddenProjects(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keys normalize trailing separators so hide and unhide match", async () => {
  const dir = freshAgentDir();
  try {
    await hideProject(dir, "/tmp/proj/", "proj");
    await unhideProject(dir, "/tmp/proj");
    assert.deepEqual(readProjectVisibility(dir), { hidden: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt visibility file degrades to empty and self-heals on write", async () => {
  const dir = freshAgentDir();
  try {
    writeFileSync(getProjectVisibilityPath(dir), "[]", "utf8");
    assert.deepEqual(listHiddenProjects(dir), []);
    await hideProject(dir, "/tmp/p", "p");
    assert.equal(listHiddenProjects(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("entries missing a path are dropped by the sanitizer", async () => {
  const dir = freshAgentDir();
  try {
    writeFileSync(
      getProjectVisibilityPath(dir),
      JSON.stringify({ hidden: { bad: { name: "x" }, ok: { path: "/tmp/ok", name: "ok", hiddenAt: "" } } }),
      "utf8",
    );
    const hidden = listHiddenProjects(dir);
    assert.deepEqual(hidden.map((h) => h.key), ["ok"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent hides of different projects both persist", async () => {
  const dir = freshAgentDir();
  try {
    await Promise.all([
      hideProject(dir, "/tmp/one", "one"),
      hideProject(dir, "/tmp/two", "two"),
    ]);
    assert.deepEqual(listHiddenProjects(dir).map((h) => h.name).sort(), ["one", "two"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
