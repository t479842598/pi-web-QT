import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { isSubagentToolDetails } = await createJiti(import.meta.url)
  .import("./subagent-tool-details.ts");

test("accepts a well-formed subagent details payload", () => {
  assert.equal(isSubagentToolDetails({
    kind: "pi-web-subagent",
    sessionId: "abc",
    profile: "Explore",
    description: "look around",
    status: "running",
  }), true);
});

test("rejects anything that is not subagent details", () => {
  for (const value of [
    null,
    undefined,
    "pi-web-subagent",
    42,
    {},
    { kind: "other", sessionId: "abc" },
    { kind: "pi-web-subagent" },
    { kind: "pi-web-subagent", sessionId: 7 },
  ]) {
    assert.equal(isSubagentToolDetails(value), false, `value=${JSON.stringify(value)}`);
  }
});

test("rejects an unknown status instead of letting it render as completed", () => {
  // The row's status label falls through to "completed" for anything
  // unrecognised, which would paint a failed run green.
  for (const status of [undefined, "", "bogus", "RUNNING", 7, null]) {
    assert.equal(
      isSubagentToolDetails({ kind: "pi-web-subagent", sessionId: "abc", status }),
      false,
      `status=${JSON.stringify(status)}`,
    );
  }
});

test("accepts every documented run status", () => {
  for (const status of ["starting", "running", "completed", "failed", "aborted", "interrupted"]) {
    assert.equal(
      isSubagentToolDetails({ kind: "pi-web-subagent", sessionId: "abc", status }),
      true,
      `status=${status}`,
    );
  }
});
