import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { restoreSessionFiles } from "./backup-sessions.ts";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const temporary = mkdtempSync(join(tmpdir(), "pi-backup-sessions-test-"));
process.env.PI_CODING_AGENT_DIR = join(temporary, "initial");
mkdirSync(process.env.PI_CODING_AGENT_DIR);
const jiti = createJiti(import.meta.url, { fsCache: false });
const { createBackupZip, parseBackupZip, cleanupParsedBackup, restoreBackup, BACKUP_ROOT } = await jiti.import("./backup.ts");
const { loadQueue } = await jiti.import("./queue-store.ts");
const { loadGoalState } = await jiti.import("./goal-engine.ts");

after(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(temporary, { recursive: true, force: true });
});

const relative = join("sessions", "fixture workspace", "2026-01-01_fixture.jsonl");
const header = { type: "session", version: 3, id: "backup-fixture", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/original/workspace" };
const transcript = [
  header,
  { type: "message", id: "user-1", parentId: null, timestamp: header.timestamp, message: { role: "user", content: "保留原始历史\n不要自动执行", timestamp: 1767225600000 } },
].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
const queue = { version: 1, entries: [{ id: "queued-1", kind: "followUp", text: "manual recovery only", queuedAt: 1767225600000 }] };
const goal = { version: 1, state: { status: "running", goalText: "restore without continuing", turnsUsed: 2, turnsLimit: 10 } };

function fixture(t) {
  const source = mkdtempSync(join(temporary, "source-"));
  const target = mkdtempSync(join(temporary, "target-"));
  const session = join(source, relative);
  mkdirSync(dirname(session), { recursive: true });
  writeFileSync(session, transcript);
  writeFileSync(`${session}.queue.json`, JSON.stringify(queue));
  writeFileSync(`${session}.goal.json`, JSON.stringify(goal));
  process.env.PI_CODING_AGENT_DIR = source;
  const archive = createBackupZip({ includeSecrets: false, includeSessions: true });
  const parsed = parseBackupZip(archive);
  t.after(() => cleanupParsedBackup(parsed));
  process.env.PI_CODING_AGENT_DIR = target;
  return { source, target, parsed, session: join(target, relative) };
}
const selections = { categories: ["sessions"], skippedMcpServers: [] };

test("restores missing transcript and queue, pauses goals, and the SDK can reopen history", (t) => {
  const { parsed, session } = fixture(t);
  const { report } = restoreBackup(parsed, selections);
  assert.equal(readFileSync(session, "utf8"), transcript);
  assert.deepEqual(loadQueue(session), queue.entries);
  assert.equal(loadGoalState(session).status, "paused");
  assert.equal(loadGoalState(session).goalText, goal.state.goalText);
  assert.equal(loadGoalState(session).turnsUsed, 2);
  const manager = SessionManager.open(session);
  assert.equal(manager.getSessionId(), header.id);
  assert.equal(manager.getEntries().length, 1);
  assert.equal(manager.getEntries()[0].message.content, "保留原始历史\n不要自动执行");
  assert.ok(report.restored.includes(relative.replaceAll("\\", "/")));
  assert.ok(report.warnings.some((warning) => /paused/i.test(warning)));
  if (process.platform !== "win32") {
    for (const suffix of ["", ".queue.json", ".goal.json"]) assert.equal(statSync(session + suffix).mode & 0o777, 0o600);
  }
  assert.deepEqual(readdirSync(dirname(session)).sort(), ["2026-01-01_fixture.jsonl", "2026-01-01_fixture.jsonl.goal.json", "2026-01-01_fixture.jsonl.queue.json"]);
});

for (const suffix of ["", ".queue.json", ".goal.json"]) {
  test(`an existing ${suffix || "transcript"} skips the entire session group`, (t) => {
    const { parsed, session } = fixture(t);
    mkdirSync(dirname(session), { recursive: true });
    writeFileSync(session + suffix, "existing bytes must survive");
    const { report } = restoreBackup(parsed, selections);
    assert.equal(readFileSync(session + suffix, "utf8"), "existing bytes must survive");
    assert.deepEqual(readdirSync(dirname(session)), [`2026-01-01_fixture.jsonl${suffix}`]);
    assert.equal(report.restored.length, 0);
    assert.ok(report.warnings.some((warning) => /skip.*exist/i.test(warning)));
  });
}

test("deselecting sessions leaves its destination untouched", (t) => {
  const { parsed, target } = fixture(t);
  const { report } = restoreBackup(parsed, { categories: [], skippedMcpServers: [] });
  assert.deepEqual(readdirSync(target), []);
  assert.equal(report.restored.length, 0);
});

for (const level of ["sessions", "workspace"]) {
  test(`a symlink at the target ${level} cannot redirect writes`, (t) => {
    const { parsed, target, session } = fixture(t);
    const outside = mkdtempSync(join(temporary, "outside-"));
    const link = level === "sessions" ? join(target, "sessions") : dirname(session);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    const { report } = restoreBackup(parsed, selections);
    assert.deepEqual(readdirSync(outside), []);
    assert.equal(report.restored.length, 0);
    assert.ok(report.warnings.some((warning) => /symlink|symbolic/i.test(warning)));
  });
}

test("does not restore orphan sidecars or cached session indexes", (t) => {
  const { parsed, target } = fixture(t);
  const directory = join(parsed.tempDir, BACKUP_ROOT, "sessions", "fixture workspace");
  writeFileSync(join(directory, "orphan.jsonl.goal.json"), JSON.stringify(goal));
  writeFileSync(join(directory, "index.json"), "{}");
  const { report } = restoreBackup(parsed, selections);
  assert.equal(existsSync(join(target, "sessions", "fixture workspace", "orphan.jsonl.goal.json")), false);
  assert.equal(existsSync(join(target, "sessions", "fixture workspace", "index.json")), false);
  assert.ok(report.warnings.some((warning) => /orphan|unsupported/i.test(warning)));
});

test("invalid goal JSON skips the group without leaking its content", (t) => {
  const { parsed, session } = fixture(t);
  writeFileSync(join(parsed.tempDir, BACKUP_ROOT, relative + ".goal.json"), "SECRET_INVALID_GOAL {");
  const { report } = restoreBackup(parsed, selections);
  assert.equal(existsSync(session), false);
  assert.equal(existsSync(session + ".queue.json"), false);
  assert.equal(report.restored.length, 0);
  assert.ok(report.warnings.some((warning) => /invalid.*goal/i.test(warning)));
  assert.equal(JSON.stringify(report).includes("SECRET_INVALID_GOAL"), false);
});

test("source symlinks are never copied, even if a parsed directory is changed", (t) => {
  const { parsed, session } = fixture(t);
  const sourceFile = join(parsed.tempDir, BACKUP_ROOT, relative);
  rmSync(sourceFile);
  const outside = join(temporary, "source-link-target.txt");
  writeFileSync(outside, transcript);
  symlinkSync(outside, sourceFile, "file");
  const { report } = restoreBackup(parsed, selections);
  assert.equal(existsSync(session), false);
  assert.equal(report.restored.length, 0);
  assert.ok(report.warnings.some((warning) => /symlink|symbolic/i.test(warning)));
});

for (const conflict of [false, true]) {
  test(`publication failure cleans only this restore's files (conflict=${conflict})`, (t) => {
    const { parsed, session } = fixture(t);
    const originalLink = fs.linkSync;
    let calls = 0;
    const mock = t.mock.method(fs, "linkSync", (source, destination) => {
      calls += 1;
      if (calls === 2) {
        if (conflict) writeFileSync(destination, "created by another writer");
        const error = new Error("injected publication failure");
        error.code = conflict ? "EEXIST" : "EIO";
        throw error;
      }
      return originalLink(source, destination);
    });
    syncBuiltinESMExports();
    try {
      const report = restoreSessionFiles(join(parsed.tempDir, BACKUP_ROOT, "sessions"), process.env.PI_CODING_AGENT_DIR);
      assert.equal(calls, 2, "injected failure must actually be reached");
      assert.equal(existsSync(session), false);
      assert.equal(existsSync(`${session}.queue.json`), false);
      assert.equal(report.restored.length, 0);
      assert.ok(report.warnings.some((warning) => /skip.*session/i.test(warning)));
      if (conflict) assert.equal(readFileSync(`${session}.goal.json`, "utf8"), "created by another writer");
      assert.deepEqual(readdirSync(dirname(session)), conflict ? ["2026-01-01_fixture.jsonl.goal.json"] : []);
    } finally {
      mock.mock.restore();
      syncBuiltinESMExports();
    }
  });
}

test("rollback preserves a published path replaced by another writer", (t) => {
  const { parsed, session } = fixture(t);
  const originalLink = fs.linkSync;
  const originalStat = fs.lstatSync;
  const originalInode = 9007199254740992n;
  const replacementInode = originalInode + 1n;
  assert.equal(Number(originalInode), Number(replacementInode));
  mkdirSync(dirname(session), { recursive: true });
  const directory = fs.realpathSync(dirname(session));
  // Exercise high-bit inode identities even on filesystems with smaller numbers.
  const statMock = t.mock.method(fs, "lstatSync", (path, options) => {
    const info = originalStat(path, options);
    const text = String(path);
    if (text.startsWith(join(directory, ".restore-")) || text === join(directory, "2026-01-01_fixture.jsonl.queue.json")) {
      const inode = text.endsWith(".queue.json") ? replacementInode : originalInode;
      info.ino = options?.bigint ? inode : Number(inode);
    }
    return info;
  });
  let calls = 0;
  const mock = t.mock.method(fs, "linkSync", (source, destination) => {
    calls += 1;
    if (calls === 2) {
      fs.unlinkSync(`${session}.queue.json`);
      writeFileSync(`${session}.queue.json`, "replacement from another writer");
      throw new Error("injected publication failure");
    }
    return originalLink(source, destination);
  });
  syncBuiltinESMExports();
  try {
    const report = restoreSessionFiles(join(parsed.tempDir, BACKUP_ROOT, "sessions"), process.env.PI_CODING_AGENT_DIR);
    assert.equal(calls, 2);
    assert.equal(readFileSync(`${session}.queue.json`, "utf8"), "replacement from another writer");
    assert.equal(existsSync(session), false);
    assert.equal(report.restored.length, 0);
  } finally {
    mock.mock.restore();
    statMock.mock.restore();
    syncBuiltinESMExports();
  }
});

test("staging cleanup failure preserves the report and continues with later sessions", (t) => {
  const { parsed, session } = fixture(t);
  const sourceDirectory = dirname(join(parsed.tempDir, BACKUP_ROOT, relative));
  const secondName = "2026-01-02_second.jsonl";
  writeFileSync(join(sourceDirectory, secondName), transcript.replace('"backup-fixture"', '"backup-second"'));
  const originalRm = fs.rmSync;
  let failures = 0;
  const mock = t.mock.method(fs, "rmSync", (path, options) => {
    if (String(path).includes(".restore-")) {
      failures += 1;
      throw Object.assign(new Error("simulated sharing violation"), { code: "EBUSY" });
    }
    return originalRm(path, options);
  });
  syncBuiltinESMExports();
  try {
    const report = restoreSessionFiles(join(parsed.tempDir, BACKUP_ROOT, "sessions"), process.env.PI_CODING_AGENT_DIR);
    assert.equal(failures, 2);
    assert.equal(readFileSync(session, "utf8"), transcript);
    assert.ok(existsSync(join(dirname(session), secondName)));
    assert.equal(report.restored.filter((name) => name.endsWith(".jsonl")).length, 2);
    assert.equal(report.warnings.filter((warning) => /staging.*cleanup/i.test(warning)).length, 2);
  } finally {
    mock.mock.restore();
    syncBuiltinESMExports();
  }
});
