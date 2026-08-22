import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("tracks streamed assistant content to derive a token rate", () => {
  // The rate tracker must count chars from assistant content blocks (text +
  // thinking) and feed a 1s sliding window.
  const rateSource = source.slice(
    source.indexOf("// ── Live token rate"),
    source.indexOf("const countAssistantChars"),
  );
  assert.match(rateSource, /tokens\/sec/);
  assert.match(rateSource, /window: \[\]/);

  const counterSource = source.slice(
    source.indexOf("const countAssistantChars"),
    source.indexOf("const trackTokenRate"),
  );
  assert.match(counterSource, /msg\.role !== "assistant"/);
  assert.match(counterSource, /estimateTokens/);
  assert.match(counterSource, /typeof b\.text === "string"/);
  assert.match(counterSource, /typeof b\.thinking === "string"/);

  const trackerSource = source.slice(
    source.indexOf("const trackTokenRate"),
    source.indexOf("// Single active panel"),
  );
  assert.match(trackerSource, /ref\.window\.push/);
  assert.match(trackerSource, /cutoff = now - 1000/);
  assert.match(trackerSource, /perSec = /);
  assert.match(trackerSource, /setTokenRate/);
});

test("resets the token rate when a run starts or ends", () => {
  const agentStartSource = source.slice(
    source.indexOf('case "agent_start"'),
    source.indexOf('case "agent_end"'),
  );
  assert.match(agentStartSource, /resetTokenRate\(\)/);
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );
  assert.match(agentEndSource, /resetTokenRate\(\)/);
});

test("feeds tokenRate into streamed assistant messages", () => {
  const updateSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  assert.match(updateSource, /trackTokenRate\(msg\)/);
});

test("exposes tokenRate from the hook return", () => {
  assert.match(source, /\btokenRate,/);
});
