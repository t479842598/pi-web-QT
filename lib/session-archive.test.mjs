import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const {
  getSessionArchivePath,
  readSessionArchive,
  setSessionArchived,
  dropSessionArchiveEntry,
} = await createJiti(import.meta.url).import("./session-archive.ts");

function freshAgentDir() {
  return mkdtempSync(join(tmpdir(), "pi-web-archive-"));
}

test("archive round-trips a session id with a timestamp", async () => {
  const dir = freshAgentDir();
  try {
    assert.deepEqual(readSessionArchive(dir), {});
    await setSessionArchived(dir, "s-1", true);
    const after = readSessionArchive(dir);
    assert.equal(Object.keys(after).length, 1);
    assert.ok(Date.parse(after["s-1"].archivedAt) > 0);

    await setSessionArchived(dir, "s-1", false);
    assert.deepEqual(readSessionArchive(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-archiving keeps the original archivedAt (no-op skips the write)", async () => {
  const dir = freshAgentDir();
  try {
    await setSessionArchived(dir, "s-1", true);
    const first = readSessionArchive(dir)["s-1"].archivedAt;
    await new Promise((r) => setTimeout(r, 5));
    await setSessionArchived(dir, "s-1", true);
    assert.equal(readSessionArchive(dir)["s-1"].archivedAt, first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt archive file degrades to empty and self-heals on write", async () => {
  const dir = freshAgentDir();
  try {
    writeFileSync(getSessionArchivePath(dir), "{not json", "utf8");
    assert.deepEqual(readSessionArchive(dir), {});
    await setSessionArchived(dir, "s-2", true);
    assert.ok(readSessionArchive(dir)["s-2"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent archives of different sessions both persist", async () => {
  const dir = freshAgentDir();
  try {
    await Promise.all([
      setSessionArchived(dir, "a", true),
      setSessionArchived(dir, "b", true),
      setSessionArchived(dir, "c", true),
    ]);
    assert.deepEqual(Object.keys(readSessionArchive(dir)).sort(), ["a", "b", "c"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dropSessionArchiveEntry removes only the target id", async () => {
  const dir = freshAgentDir();
  try {
    await setSessionArchived(dir, "a", true);
    await setSessionArchived(dir, "b", true);
    await dropSessionArchiveEntry(dir, "a");
    assert.deepEqual(Object.keys(readSessionArchive(dir)), ["b"]);
    // Dropping an absent id is a no-op and must not throw.
    await dropSessionArchiveEntry(dir, "missing");
    assert.deepEqual(Object.keys(readSessionArchive(dir)), ["b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
