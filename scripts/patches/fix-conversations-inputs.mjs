#!/usr/bin/env node
// Fix conversations inputs mapping for tool results / tool calls.
// Usage: node fix-conversations-inputs.mjs <target-file.js>
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: fix-conversations-inputs.mjs <file.js>");
  process.exit(1);
}
let src = readFileSync(target, "utf8");

const OLD = `function toConversationsInputs(messages) {
    return messages.map((message) => {
        if (typeof message.content === "string") {
            return { role: message.role, content: sanitizeSurrogates(message.content) };
        }
        const text = (message.content || [])
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("\\n");
        return { role: message.role, content: text || "" };
    });
}`;

const NEW = `function conversationsTextOf(content) {
    if (typeof content === "string") {
        return sanitizeSurrogates(content);
    }
    return sanitizeSurrogates((content || [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\\n"));
}
function toConversationsInputs(messages) {
    const inputs = [];
    for (const message of messages) {
        if (message.role === "toolResult") {
            inputs.push({
                tool_call_id: message.toolCallId ?? "",
                result: conversationsTextOf(message.content),
            });
            continue;
        }
        const contentBlocks = Array.isArray(message.content) ? message.content : null;
        const text = contentBlocks
            ? contentBlocks.filter((item) => item.type === "text").map((item) => item.text).join("\\n")
            : (typeof message.content === "string" ? message.content : "");
        if (text.trim() !== "" || !contentBlocks) {
            inputs.push({ role: message.role, content: sanitizeSurrogates(text) });
        }
        if (contentBlocks) {
            for (const block of contentBlocks) {
                if (block.type === "toolCall") {
                    inputs.push({
                        tool_call_id: block.id ?? "",
                        name: block.name,
                        arguments: typeof block.arguments === "string"
                            ? block.arguments
                            : JSON.stringify(block.arguments ?? {}),
                    });
                }
            }
        }
    }
    return inputs;
}`;

if (!src.includes(OLD)) {
  console.error("FAIL: old toConversationsInputs not found in " + target);
  process.exit(1);
}
src = src.replace(OLD, NEW);
writeFileSync(target, src, "utf8");
console.log("fixed " + target);
