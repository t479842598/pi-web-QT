#!/usr/bin/env node
// Patch @earendil-works/pi-ai mistral-conversations module to call the
// Mistral /v1/conversations API (conversations schema) instead of the
// OpenAI-style /v1/chat/completions via the Mistral SDK.
// Usage: node patch-mistral-conversations.mjs <target-file.js>
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: patch-mistral-conversations.mjs <file.js>");
  process.exit(1);
}

let src = readFileSync(target, "utf8");

const replacements = [];

// 1. Add headersToRecord import after the existing imports.
replacements.push({
  name: "import headersToRecord",
  from: 'import { transformMessages } from "./transform-messages.js";',
  to: 'import { transformMessages } from "./transform-messages.js";\nimport { headersToRecord } from "../utils/headers.js";',
});

// 2. Replace the SDK client + chat.stream call with a conversations fetch.
replacements.push({
  name: "stream body",
  from: `            // Intentionally per-request: avoids shared SDK mutable state across concurrent consumers.
            const mistral = new Mistral({
                apiKey,
                serverURL: model.baseUrl,
                ...(options?.fetch ? { httpClient: new HTTPClient({ fetcher: options.fetch }) } : {}),
            });
            const normalizeMistralToolCallId = createMistralToolCallIdNormalizer();
            const transformedMessages = transformMessages(context.messages, model, (id) => normalizeMistralToolCallId(id));
            let payload = buildChatPayload(model, context, transformedMessages, options);
            const nextPayload = await options?.onPayload?.(payload, model);
            if (nextPayload !== undefined) {
                payload = nextPayload;
            }
            const mistralStream = await mistral.chat.stream(payload, buildRequestOptions(model, options));
            stream.push({ type: "start", partial: output });
            await consumeChatStream(model, output, stream, mistralStream);
            if (options?.signal?.aborted) {
                throw new Error("Request was aborted");
            }
            if (output.stopReason === "pending") {
                throw new Error("Mistral stream ended without a finish reason");
            }`,
  to: `            const normalizeMistralToolCallId = createMistralToolCallIdNormalizer();
            const transformedMessages = transformMessages(context.messages, model, (id) => normalizeMistralToolCallId(id));
            let payload = buildConversationsPayload(model, context, transformedMessages, options);
            const nextPayload = await options?.onPayload?.(payload, model);
            if (nextPayload !== undefined) {
                payload = nextPayload;
            }
            const baseUrl = (model.baseUrl || "https://api.mistral.ai").replace(/\\/+$/, "");
            const url = /\\/v1$/.test(baseUrl) ? \`\${baseUrl}/conversations\` : \`\${baseUrl}/v1/conversations\`;
            const headers = {
                "Content-Type": "application/json",
                Authorization: \`Bearer \${apiKey}\`,
            };
            if (model.headers) Object.assign(headers, model.headers);
            if (options?.headers) Object.assign(headers, options.headers);
            const response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
                ...(options?.signal ? { signal: options.signal } : {}),
            });
            await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
            if (!response.ok) {
                const bodyText = await response.text().catch(() => "");
                throw new Error(\`Mistral API error (\${response.status}): \${bodyText || response.statusText}\`);
            }
            if (!response.body) {
                throw new Error("Empty response body");
            }
            stream.push({ type: "start", partial: output });
            await consumeConversationsStream(model, output, stream, response.body);
            if (options?.signal?.aborted) {
                throw new Error("Request was aborted");
            }
            if (output.stopReason === "pending") {
                output.stopReason = "stop";
            }`,
});

// 3. Add the conversations helpers before toFunctionTools.
const helpers = `
function toConversationsInputs(messages) {
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
}
function buildConversationsPayload(model, context, messages, options) {
    const completionArgs = {
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2048,
        top_p: 1,
    };
    return {
        model: model.id,
        inputs: toConversationsInputs(messages),
        tools: context.tools?.length ? toFunctionTools(context.tools) : [],
        completion_args: completionArgs,
        instructions: context.systemPrompt ?? "",
        stream: true,
    };
}
async function consumeConversationsStream(model, output, stream, body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentBlock = null;
    const blocks = output.content;
    const blockIndex = () => blocks.length - 1;
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
            output.stopReason = "stop";
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
}
`;
replacements.push({
  name: "add conversations helpers",
  from: "function toFunctionTools(tools) {",
  to: helpers + "function toFunctionTools(tools) {",
});

for (const r of replacements) {
  if (!src.includes(r.from)) {
    console.error(`FAIL: replacement "${r.name}" did not match in ${target}`);
    process.exit(1);
  }
  src = src.replace(r.from, r.to);
  console.log(`OK: ${r.name}`);
}

writeFileSync(target, src, "utf8");
console.log(`patched ${target}`);
