#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");

/** Keep the V8 heap from ballooning during local runs. Next.js dev auto-sets
 *  --max-old-space-size to 50% of physical RAM (12GB on a 24GB machine)
 *  unless the user already capped it. A 3GB cap makes GC engage earlier and
 *  bounds RSS growth for both dev and production start. Also consumed by
 *  bin/pi-web.js to seed NODE_OPTIONS before spawning the server.
 */
function mergedNodeOptions(existing) {
  const base = existing ?? "";
  const hasHeapLimit = /(^|\s)--max-old-space-size=\d+/.test(base);
  const flags = hasHeapLimit ? [] : [`--max-old-space-size=3072`, `--max-semi-space-size=128`];
  return [...flags, base].filter(Boolean).join(" ");
}

module.exports = { mergedNodeOptions };

// CLI: with-memory-limit <task> — runs a fixed Next.js task with the capped
// heap. Each task is a fully literal spawn (constant program, constant argv,
// relative to the package root that npm scripts guarantee as cwd), so nothing
// from the command line or environment ever reaches a spawn. The heap cap
// rides as literal V8 flags in argv, which take precedence over any inherited
// NODE_OPTIONS for this process tree.

if (require.main === module) {
  const [taskName] = process.argv.slice(2);
  let result;
  if (taskName === "nextDev") {
    result = spawnSync("node", [
      "--max-old-space-size=3072",
      "--max-semi-space-size=128",
      "node_modules/next/dist/bin/next",
      "dev", "-H", "127.0.0.1", "-p", "0", "--turbopack",
    ], { stdio: "inherit" });
  } else if (taskName === "nextStart") {
    result = spawnSync("node", [
      "--max-old-space-size=3072",
      "--max-semi-space-size=128",
      "node_modules/next/dist/bin/next",
      "start", "-H", "127.0.0.1", "-p", "0",
    ], { stdio: "inherit" });
  } else {
    console.error("usage: node bin/with-memory-limit.js nextDev|nextStart");
    process.exit(1);
  }
  if (result.error) {
    console.error(`with-memory-limit: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}
