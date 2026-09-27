import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  crossesChatOnlyBoundary,
  isChatOnlySession,
  resolveStartupToolSelection,
} = await createJiti(import.meta.url).import("./tool-selection-policy.ts");

// ── resolveStartupToolSelection ─────────────────────────────────────────────

test("an absent selection stays absent instead of collapsing into an empty one", () => {
  assert.equal(resolveStartupToolSelection({
    subagentTools: undefined,
    persistedTools: undefined,
    requestedTools: undefined,
  }), undefined);
});

test("an empty selection is a real selection, not an absent one", () => {
  assert.deepEqual(resolveStartupToolSelection({
    subagentTools: undefined,
    persistedTools: undefined,
    requestedTools: [],
  }), []);
});

test("a subagent profile outranks the persisted pin, which outranks the request", () => {
  assert.deepEqual(resolveStartupToolSelection({
    subagentTools: ["read"],
    persistedTools: ["bash"],
    requestedTools: ["write"],
  }), ["read"]);
  assert.deepEqual(resolveStartupToolSelection({
    subagentTools: undefined,
    persistedTools: ["bash"],
    requestedTools: ["write"],
  }), ["bash"]);
  assert.deepEqual(resolveStartupToolSelection({
    subagentTools: undefined,
    persistedTools: undefined,
    requestedTools: ["write"],
  }), ["write"]);
});

test("the resolved selection is copied so later mutation cannot leak", () => {
  const requested = ["read"];
  const resolved = resolveStartupToolSelection({
    subagentTools: undefined,
    persistedTools: undefined,
    requestedTools: requested,
  });
  resolved.push("bash");
  assert.deepEqual(requested, ["read"]);
});

// ── isChatOnlySession ───────────────────────────────────────────────────────

test("no selection is not chat-only", () => {
  // The regression: `undefined` collapsed to `[]` made every unpinned session
  // chat-only, so its resource loader skipped extensions entirely (#782).
  assert.equal(isChatOnlySession({ toolSelection: undefined, subagentLoadsResources: false }), false);
});

test("an empty selection is chat-only", () => {
  assert.equal(isChatOnlySession({ toolSelection: [], subagentLoadsResources: false }), true);
});

test("a non-empty selection is not chat-only", () => {
  assert.equal(isChatOnlySession({ toolSelection: ["read"], subagentLoadsResources: false }), false);
});

test("a subset that loads its own resources is never chat-only", () => {
  assert.equal(isChatOnlySession({ toolSelection: [], subagentLoadsResources: true }), false);
  assert.equal(isChatOnlySession({ toolSelection: ["read"], subagentLoadsResources: true }), false);
});

test("the chat-only verdict matches the upstream one for a subagent profile", () => {
  // Upstream: `selectedToolNames?.length === 0 && !subagentLoadsResources`.
  const oracle = (tools, loadsResources) => tools?.length === 0 && !loadsResources;
  for (const tools of [undefined, [], ["read"]]) {
    for (const loadsResources of [false, true]) {
      assert.equal(
        isChatOnlySession({ toolSelection: tools, subagentLoadsResources: loadsResources }),
        oracle(tools, loadsResources),
        `tools=${JSON.stringify(tools)} loadsResources=${loadsResources}`,
      );
    }
  }
});

// ── crossesChatOnlyBoundary ─────────────────────────────────────────────────

test("un-pinning a normal session does not cross the chat-only boundary", () => {
  assert.equal(crossesChatOnlyBoundary({ currentChatOnly: false, nextTools: undefined }), false);
});

test("un-pinning a chat-only session does cross the boundary", () => {
  assert.equal(crossesChatOnlyBoundary({ currentChatOnly: true, nextTools: undefined }), true);
});

test("turning every tool off crosses the boundary, and turning them back on crosses it again", () => {
  assert.equal(crossesChatOnlyBoundary({ currentChatOnly: false, nextTools: [] }), true);
  assert.equal(crossesChatOnlyBoundary({ currentChatOnly: true, nextTools: ["read"] }), true);
});

test("re-applying the same kind of selection stays inside the boundary", () => {
  assert.equal(crossesChatOnlyBoundary({ currentChatOnly: false, nextTools: ["read", "bash"] }), false);
  assert.equal(crossesChatOnlyBoundary({ currentChatOnly: true, nextTools: [] }), false);
});
