#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");

/** Keep the V8 heap from ballooning during local runs. Next.js dev auto-sets
 *  --max-old-space-size to 50% of physical RAM (12GB on a 24GB machine)
 *  unless the user already capped it. A 3GB cap makes GC engage earlier and
 *  bounds RSS growth for both dev and production start.
 */
const MEMORY_LIMIT_MB = 3072;
const SEMI_SPACE_MB = 128;

/**
 * Merge a heap cap into an existing NODE_OPTIONS value. If the user already
 * set --max-old-space-size explicitly, theirs wins (we only add the semi-space
 * hint); otherwise we append both flags so V8 and Next.js see a hard cap.
 */
function mergedNodeOptions(existing) {
  const base = existing ?? "";
  const hasHeapLimit = /(^|\s)--max-old-space-size=\d+/.test(base);
  const flags = hasHeapLimit ? [] : [`--max-old-space-size=${MEMORY_LIMIT_MB}`, `--max-semi-space-size=${SEMI_SPACE_MB}`];
  return [...flags, base].filter(Boolean).join(" ");
}

module.exports = { mergedNodeOptions, MEMORY_LIMIT_MB, SEMI_SPACE_MB };

// CLI: with-memory-limit <cmd> [args...] — runs cmd with the capped heap.
// Child processes spawned by cmd inherit NODE_OPTIONS, so next dev / next
// start and their next-server children all see the same limit.
if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) {
    console.error("usage: node bin/with-memory-limit.js <cmd> [args...]");
    process.exit(1);
  }
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, NODE_OPTIONS: mergedNodeOptions(process.env.NODE_OPTIONS) },
  });
  if (result.error) {
    console.error(`with-memory-limit: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}
