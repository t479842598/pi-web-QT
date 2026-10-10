import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./file-upload.ts");
}

test("defines bounded per-file, aggregate, and wire upload limits", async () => {
  const { MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_REQUEST_BYTES, MAX_UPLOAD_TOTAL_BYTES } = await loadSubject();

  assert.equal(MAX_UPLOAD_FILE_BYTES, 25 * 1024 * 1024);
  assert.equal(MAX_UPLOAD_TOTAL_BYTES, 100 * 1024 * 1024);
  assert.equal(MAX_UPLOAD_REQUEST_BYTES, MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024);
});

test("validates upload names without accepting paths or duplicates", async () => {
  const { validateUploadFileNames } = await loadSubject();

  assert.equal(validateUploadFileNames(["one.txt", "two file.md"]), null);
  assert.match(validateUploadFileNames(["../secret.txt"]), /must not contain a path/);
  assert.match(validateUploadFileNames(["folder\\secret.txt"]), /must not contain a path/);
  assert.match(validateUploadFileNames(["same.txt", "same.txt"]), /Duplicate/);
  assert.match(validateUploadFileNames([]), /No files/);
});

test("finds conflicts and prevents replacing directories or symlinks", async (t) => {
  const { inspectUploadTargets } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, "file.txt"), "old");
  fs.mkdirSync(path.join(root, "directory"));
  fs.symlinkSync("file.txt", path.join(root, "link.txt"));

  assert.deepEqual(
    inspectUploadTargets(root, ["new.txt", "file.txt", "directory", "link.txt"]),
    {
      conflicts: ["file.txt", "directory", "link.txt"],
      nonReplaceable: ["directory", "link.txt"],
    },
  );
});

test("parses only supported conflict strategies", async () => {
  const { parseUploadConflictStrategy } = await loadSubject();

  assert.equal(parseUploadConflictStrategy(null), "error");
  assert.equal(parseUploadConflictStrategy("overwrite"), "overwrite");
  assert.equal(parseUploadConflictStrategy("skip"), "skip");
  assert.equal(parseUploadConflictStrategy("rename"), null);
});

test("replaces a file atomically, preserving mode and leaving no staging dirs", async (t) => {
  const { replaceUploadFile } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-replace-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const destination = path.join(root, "existing.txt");
  fs.writeFileSync(destination, "old contents");
  fs.chmodSync(destination, 0o600);

  replaceUploadFile(destination, Buffer.from("new contents"));

  assert.equal(fs.readFileSync(destination, "utf8"), "new contents");
  assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  // The private staging directory is cleaned up on success.
  assert.deepEqual(fs.readdirSync(root), ["existing.txt"]);
});

test("keeps the old file intact and cleans up when the replacement cannot be staged", async (t) => {
  const { replaceUploadFile } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-replace-fail-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const destination = path.join(root, "keep.txt");
  fs.writeFileSync(destination, "original bytes");

  // Staging fails when the destination has no writable parent directory (a file
  // cannot host a child), so the original must survive and leave nothing behind.
  assert.throws(() => replaceUploadFile(path.join(destination, "nested"), Buffer.from("x")));
  assert.equal(fs.readFileSync(destination, "utf8"), "original bytes");
  assert.deepEqual(fs.readdirSync(root), ["keep.txt"]);
});

test("refuses to replace a directory or symbolic link", async (t) => {
  const { replaceUploadFile } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-replace-dir-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const directory = path.join(root, "dir");
  fs.mkdirSync(directory);
  assert.throws(() => replaceUploadFile(directory, Buffer.from("x")), /directory or symbolic link/);
  assert.equal(fs.statSync(directory).isDirectory(), true);
});
