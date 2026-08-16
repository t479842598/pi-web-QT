#!/usr/bin/env node
// Extend the patched mistral-conversations module with tool-call parsing
// (function.call.delta SSE events from /v1/conversations).
// Usage: node extend-mistral-tools.mjs <target-file.js>
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: extend-mistral-tools.mjs <file.js>");
  process.exit(1);
}

let src = readFileSync(target, "utf8");

const OLD_START = "    const handleEvent = (eventName, rawData) => {";
const OLD_END = "    finishCurrentBlock(currentBlock);\n}\n";

const oldIndex = src.indexOf(OLD_START);
if (oldIndex === -1) {
  console.error("FAIL: handleEvent marker not found (run patch first?)");
  process.exit(1);
}

// The existing consumeConversationsStream spans from its function declaration
// to "    finishCurrentBlock(currentBlock);\n}\n" — locate its start.
const funcStart = src.lastIndexOf("async function consumeConversationsStream(", oldIndex);
if (funcStart === -1) {
  console.error("FAIL: consumeConversationsStream not found");
  process.exit(1);
}
const funcEnd = src.indexOf(OLD_END, oldIndex);
if (funcEnd === -1) {
  console.error("FAIL: end marker not found");
  process.exit(1);
}
const endPos = funcEnd + OLD_END.length;

const NEW_FUNC = `async function consumeConversationsStream(model, output, stream, body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentBlock = null;
    const blocks = output.content;
    const blockIndex = () => blocks.length - 1;
    const toolBlocksByKey = new Map();
    const finishCurrentBlock = (block) => {
        if (!block) return;
        if (block.type === "text") {
            stream.push({
                type: "text_end",
                contentIndex: blockIndex(),
                content: block.text,
                partial: output,
            });
        }
    };
    const ensureToolBlock = (data) => {
        const callId = data.tool_call_id || data.id || "";
        const key = \`\${callId}:\${data.output_index ?? 0}\`;
        const existingIndex = toolBlocksByKey.get(key);
        if (existingIndex !== undefined) {
            const existing = output.content[existingIndex];
            if (existing?.type === "toolCall") return { block: existing, index: existingIndex };
        }
        const block = {
            type: "toolCall",
            id: callId,
            name: data.name,
            arguments: {},
            partialArgs: "",
        };
        output.content.push(block);
        toolBlocksByKey.set(key, output.content.length - 1);
        stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
        return { block, index: output.content.length - 1 };
    };
    const handleEvent = (eventName, rawData) => {
        let data;
        try {
            data = JSON.parse(rawData);
        } catch {
            return;
        }
        const type = data.type || eventName;
        if (type === "conversation.response.started") {
            output.responseId ||= data.conversation_id;
            return;
        }
        if (type === "message.output.delta") {
            const delta = data.content;
            if (delta === undefined || delta === null) return;
            const textDelta = sanitizeSurrogates(typeof delta === "string" ? delta : JSON.stringify(delta));
            if (!currentBlock || currentBlock.type !== "text") {
                finishCurrentBlock(currentBlock);
                currentBlock = { type: "text", text: "" };
                output.content.push(currentBlock);
                stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
            }
            currentBlock.text += textDelta;
            stream.push({
                type: "text_delta",
                contentIndex: blockIndex(),
                delta: textDelta,
                partial: output,
            });
            return;
        }
        if (type === "function.call.delta") {
            if (currentBlock) {
                finishCurrentBlock(currentBlock);
                currentBlock = null;
            }
            const { block, index } = ensureToolBlock(data);
            const argsDelta = typeof data.arguments === "string"
                ? data.arguments
                : JSON.stringify(data.arguments || {});
            block.partialArgs = (block.partialArgs || "") + argsDelta;
            block.arguments = parseStreamingJson(block.partialArgs);
            stream.push({
                type: "toolcall_delta",
                contentIndex: index,
                delta: argsDelta,
                partial: output,
            });
            return;
        }
        if (type === "conversation.response.done" || type === "conversation.response.completed") {
            const usage = data.usage;
            if (usage) {
                const promptTokens = usage.prompt_tokens ?? usage.promptTokens ?? 0;
                const completionTokens = usage.completion_tokens ?? usage.completionTokens ?? 0;
                output.usage.input = Math.max(0, promptTokens);
                output.usage.output = completionTokens;
                output.usage.cacheRead = 0;
                output.usage.cacheWrite = 0;
                output.usage.totalTokens =
                    usage.total_tokens ?? usage.totalTokens ?? promptTokens + completionTokens;
                calculateCost(model, output.usage);
            }
            output.stopReason = toolBlocksByKey.size > 0 ? "toolUse" : "stop";
            return;
        }
    };
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf("\\n\\n")) !== -1) {
            const rawEvent = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            let eventName = "message";
            let dataLine = "";
            for (const line of rawEvent.split("\\n")) {
                if (line.startsWith("event:")) {
                    eventName = line.slice(6).trim();
                } else if (line.startsWith("data:")) {
                    dataLine += line.slice(5).trim();
                }
            }
            if (dataLine) handleEvent(eventName, dataLine);
        }
    }
    finishCurrentBlock(currentBlock);
    for (const index of toolBlocksByKey.values()) {
        const block = output.content[index];
        if (block.type !== "toolCall") continue;
        const toolBlock = block;
        toolBlock.arguments = parseStreamingJson(toolBlock.partialArgs);
        delete toolBlock.partialArgs;
        stream.push({
            type: "toolcall_end",
            contentIndex: index,
            toolCall: toolBlock,
            partial: output,
        });
    }
}
`;

src = src.slice(0, funcStart) + NEW_FUNC + src.slice(endPos);
writeFileSync(target, src, "utf8");
console.log(`extended ${target}`);
