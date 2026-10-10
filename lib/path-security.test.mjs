import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { hasParentDirectorySegment, isExistingPathWithinRoots, resolveRealRoots } =
  await createJiti(import.meta.url).import("./path-security.ts");

test("flags `..` segments on the platform's separator", () => {
  assert.equal(hasParentDirectorySegment("/a/b/c"), false);
  assert.equal(hasParentDirectorySegment("/a/../c"), true);
  assert.equal(hasParentDirectorySegment("/a/b/.."), true);
  // A literal backslash is part of a file name on POSIX, so it is not a segment there.
  if (process.platform !== "win32") {
    assert.equal(hasParentDirectorySegment("/a/b\\..\\c"), false);
  }
  assert.equal(hasParentDirectorySegment("C:\\a\\..\\c"), true);
});

test("resolveRealRoots drops roots that cannot be resolved", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-roots-")));
  try {
    const resolved = resolveRealRoots(new Set([root, path.join(root, "missing")]));
    assert.equal(resolved.has(root), true);
    assert.equal(resolved.size, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a `..` segment is refused even when the lexical path stays inside a root", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-link-")));
  try {
    const root = path.join(base, "root");
    const outside = path.join(base, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    let linked = true;
    try {
      fs.symlinkSync(outside, path.join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error?.code === "EPERM") linked = false;
      else throw error;
    }

    // Built by hand: path.join would collapse `..` and hide the traversal.
    const traversal = `${root}/link/..`;
    const roots = new Set([root]);
    // The lexical form (after `..` collapses) is the root itself, which looks allowed...
    assert.equal(hasParentDirectorySegment(traversal), true);
    // ...so only the `..` guard refuses it outright.
    assert.equal(isExistingPathWithinRoots(traversal, roots), false);
    if (linked) {
      // A bare link to an outside directory resolves outside the root and is refused too.
      assert.equal(isExistingPathWithinRoots(path.join(root, "link"), roots), false);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
