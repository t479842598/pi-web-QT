import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { resolveSubagentDuration } = await createJiti(import.meta.url)
  .import("./subagent-run-display.ts");

const T0 = Date.parse("2026-09-11T05:23:48.528Z");

test("a running run ticks from its own start time", () => {
  assert.equal(resolveSubagentDuration({
    startedAt: "2026-09-11T05:23:48.528Z",
    running: true,
    nowMs: T0 + 12_000,
  }), 12);
});

test("a finished run uses completedAt - createdAt, not the parent call's duration", () => {
  // The parent Agent call returned after 1s (background dispatch), while the
  // run itself took ~20s. The authoritative answer wins.
  assert.equal(resolveSubagentDuration({
    startedAt: "2026-09-11T05:23:48.528Z",
    completedAt: "2026-09-11T05:24:08.528Z",
    toolDuration: 1,
    running: false,
    nowMs: T0 + 60_000,
  }), 20);
});

test("falls back to the parent duration when the run's own times are missing", () => {
  assert.equal(resolveSubagentDuration({
    startedAt: null,
    completedAt: null,
    toolDuration: 7,
    running: false,
    nowMs: T0,
  }), 7);
});

test("returns null when nothing defensible is available", () => {
  assert.equal(resolveSubagentDuration({ running: false, nowMs: T0 }), null);
  assert.equal(resolveSubagentDuration({ running: true, nowMs: T0 }), null);
});

test("never reports a negative duration from an out-of-order range", () => {
  assert.equal(resolveSubagentDuration({
    startedAt: "2026-09-11T05:24:08.528Z",
    completedAt: "2026-09-11T05:23:48.528Z",
    running: false,
    nowMs: T0,
  }), null);
  // A clock that lags the start also must not produce a negative tick.
  assert.equal(resolveSubagentDuration({
    startedAt: "2026-09-11T05:23:48.528Z",
    running: true,
    nowMs: T0 - 5_000,
  }), null);
});

test("a running run without a start falls back to the parent duration", () => {
  assert.equal(resolveSubagentDuration({
    running: true,
    toolDuration: 3,
    nowMs: T0,
  }), 3);
});

test("malformed timestamps are ignored rather than producing NaN", () => {
  assert.equal(resolveSubagentDuration({
    startedAt: "not-a-date",
    completedAt: "also-not",
    running: false,
    nowMs: T0,
  }), null);
});
