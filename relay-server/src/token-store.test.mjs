import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTokens, saveTokens } from "./token-store.mjs";

function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), "relay-tokens-"));
  return { path: join(dir, "tokens.json"), dir };
}

test("a token store round-trips so a link survives a restart", () => {
  const { path, dir } = tempPath();
  try {
    const tokens = new Map([["dev-1", [{
      tokenHash: "abc123", scope: "remote", reusable: true,
      createdAt: 1, expiresAt: null, usedAt: null, revokedAt: null, label: "phone",
    }]]]);
    saveTokens(path, tokens);
    const loaded = loadTokens(path);
    assert.equal(loaded.size, 1);
    assert.equal(loaded.get("dev-1")[0].tokenHash, "abc123");
    assert.equal(loaded.get("dev-1")[0].reusable, true);
    assert.equal(loaded.get("dev-1")[0].expiresAt, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing store loads empty rather than throwing", () => {
  const { path, dir } = tempPath();
  try {
    assert.equal(loadTokens(path).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt store loads empty instead of taking the relay down", () => {
  const { path, dir } = tempPath();
  try {
    writeFileSync(path, "{ not json");
    assert.equal(loadTokens(path).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed records are dropped, valid ones kept", () => {
  const { path, dir } = tempPath();
  try {
    writeFileSync(path, JSON.stringify({
      version: 1,
      devices: {
        "dev-1": [
          { tokenHash: "ok", createdAt: 1, expiresAt: null, usedAt: null, revokedAt: null, scope: "remote", reusable: false, label: "" },
          { tokenHash: 7, createdAt: 1 },
          null,
        ],
      },
    }));
    const loaded = loadTokens(path);
    assert.equal(loaded.get("dev-1").length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the store never contains a raw token", () => {
  const { path, dir } = tempPath();
  try {
    saveTokens(path, new Map([["dev-1", [{
      tokenHash: "deadbeef", scope: "remote", reusable: true,
      createdAt: 1, expiresAt: null, usedAt: null, revokedAt: null, label: "x",
    }]]]));
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes("deadbeef"), true, "the digest is stored");
    assert.equal(/[A-Za-z0-9_-]{40,}/.test(raw.replace(/"deadbeef"/, "")), false, "no long opaque token present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("devices with no tokens are omitted from the file", () => {
  const { path, dir } = tempPath();
  try {
    saveTokens(path, new Map([["dev-empty", []], ["dev-1", [{
      tokenHash: "h", scope: "remote", reusable: false,
      createdAt: 1, expiresAt: 99, usedAt: null, revokedAt: null, label: "",
    }]]]));
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(Object.keys(parsed.devices), ["dev-1"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
