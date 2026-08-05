/**
 * Reasonix JSONL → pi Session JSONL 转换核心
 *
 * 从已验证的 scripts/migrate-reasonix.mjs 提炼，作为 API 可调用的纯函数。
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

// ============================================================================
// 工具函数
// ============================================================================

/** 生成 UUID v7 格式的 session ID（timestamp-based） */
export function uuidv7(): string {
  const ts = Date.now();
  const hex = (n: number, len: number) => n.toString(16).padStart(len, "0");
  const rand = () => Math.floor(Math.random() * 0x10000);

  const tsHi = Math.floor(ts / 0x100000000);
  const tsLo = ts % 0x100000000;

  const p1 = hex(tsHi, 8);
  const p2 = hex((tsLo >> 16) & 0xffff, 4);
  const p3 = hex(0x7000 | (tsLo & 0xfff), 4);
  const p4 = hex(0x8000 | (rand() & 0x3fff), 4);
  const p5 = hex(rand(), 4) + hex(rand(), 4) + hex(rand(), 4);

  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

function genEntryId(): string {
  return randomBytes(4).toString("hex");
}

// ============================================================================
// 文件名解析
// ============================================================================

/**
 * 解析 Reasonix 文件名，提取时间戳和模型信息
 * 格式: 20260721-082619.117399000-Freebuff-deepseek-deepseek-v4-flash.jsonl
 */
export function parseReasonixFilename(filename: string): {
  timestamp: string;
  provider: string;
  modelId: string;
} {
  const base = filename.replace(/\.jsonl$/, "");
  const parts = base.split("-");
  const dateStr = parts[0];
  const timeStr = parts[1];

  const y = dateStr.slice(0, 4);
  const m = dateStr.slice(4, 6);
  const d = dateStr.slice(6, 8);
  const hh = timeStr.slice(0, 2);
  const mm = timeStr.slice(2, 4);
  const ss = timeStr.slice(4, 6);
  const ms = timeStr.slice(7, 10);

  const ts = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}.${ms}Z`);

  const modelParts = parts.slice(2).join("-");
  let provider = "freebuff";
  let modelId = "unknown";

  if (modelParts) {
    const segments = modelParts.split("-");
    if (segments.length >= 3 && segments[0].toLowerCase() === "freebuff") {
      provider = "freebuff";
      modelId = segments.slice(1).join("/");
    } else if (segments.length >= 2 && segments[0].toLowerCase() !== "session") {
      provider = segments[0].toLowerCase();
      modelId = segments.slice(1).join("/");
    } else if (modelParts.toLowerCase() === "session") {
      provider = "freebuff";
      modelId = "unknown";
    } else {
      modelId = modelParts;
    }
  }

  return { timestamp: ts.toISOString(), provider, modelId };
}

// ============================================================================
// 行级转换
// ============================================================================

interface ReasonixLine {
  role?: string;
  content?: string;
  createdAt?: number;
  reasoning_content?: string;
  tool_calls?: Array<{
    id?: string;
    name?: string;
    arguments?: string | Record<string, unknown>;
  }>;
  tool_call_id?: string;
  name?: string;
}

interface PiEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  // session header
  version?: number;
  cwd?: string;
  importedFrom?: string;
  // model_change
  provider?: string;
  modelId?: string;
  // message
  message?: {
    role: string;
    content: Array<Record<string, unknown>>;
    isError?: boolean;
    toolCallId?: string;
    toolName?: string;
    timestamp?: number;
  };
}

/**
 * 转换一行 Reasonix JSON → pi entry（或 null 跳过）
 */
export function convertReasonixLine(
  line: string,
  parentId: string,
  timestamp: string,
): { entry: PiEntry | null; reason?: string } {
  if (!line || line.trim() === "") return { entry: null, reason: "empty" };

  let obj: ReasonixLine;
  try {
    obj = JSON.parse(line);
  } catch {
    return { entry: null, reason: "parse-error" };
  }

  const role = obj.role;

  // 跳过 system 消息
  if (role === "system") return { entry: null, reason: "system" };

  const id = genEntryId();

  if (role === "user") {
    const text = typeof obj.content === "string" ? obj.content : JSON.stringify(obj.content);
    const msgTs = obj.createdAt ? new Date(obj.createdAt).toISOString() : timestamp;
    return {
      entry: {
        type: "message",
        id,
        parentId,
        timestamp: msgTs,
        message: {
          role: "user",
          content: [{ type: "text", text }],
        },
      },
    };
  }

  if (role === "assistant") {
    const contentBlocks: Array<Record<string, unknown>> = [];

    if (obj.reasoning_content) {
      contentBlocks.push({
        type: "thinking",
        thinking: obj.reasoning_content,
      });
    }

    if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
      for (const tc of obj.tool_calls) {
        let args: Record<string, unknown> = {};
        if (tc.arguments) {
          try {
            args = typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments;
          } catch {
            args = { raw: tc.arguments };
          }
        }
        contentBlocks.push({
          type: "toolCall",
          id: tc.id || `reasonix_${genEntryId()}`,
          name: tc.name,
          arguments: args,
        });
      }
    }

    if (obj.content && typeof obj.content === "string" && obj.content.trim() && !obj.tool_calls) {
      contentBlocks.push({ type: "text", text: obj.content });
    }

    if (contentBlocks.length === 0) {
      return { entry: null, reason: "empty-assistant" };
    }

    return {
      entry: {
        type: "message",
        id,
        parentId,
        timestamp,
        message: {
          role: "assistant",
          content: contentBlocks,
        },
      },
    };
  }

  if (role === "tool") {
    const text = typeof obj.content === "string" ? obj.content : JSON.stringify(obj.content);
    return {
      entry: {
        type: "message",
        id,
        parentId,
        timestamp,
        message: {
          role: "toolResult",
          toolCallId: obj.tool_call_id || "unknown",
          toolName: obj.name || "unknown",
          content: [{ type: "text", text }],
          isError: false,
        },
      },
    };
  }

  // 兜底：有 content 就当 user 消息
  if (obj.content) {
    const text = typeof obj.content === "string" ? obj.content : JSON.stringify(obj.content);
    return {
      entry: {
        type: "message",
        id,
        parentId,
        timestamp,
        message: {
          role: "user",
          content: [{ type: "text", text }],
        },
      },
    };
  }

  return { entry: null, reason: `unknown-role:${role}` };
}

// ============================================================================
// 单文件完整转换
// ============================================================================

export interface ConversionResult {
  entries: PiEntry[];
  sessionId: string;
  messageCount: number;
}

/**
 * 将一个 Reasonix session 文件完整转换为 pi entry 数组
 * @param filePath Reasonix .jsonl 文件的绝对路径
 * @param cwd 原始工作目录
 * @param filename Reasonix 文件名（用于提取时间戳和模型）
 */
export function convertReasonixFile(
  filePath: string,
  cwd: string,
  filename: string,
): ConversionResult {
  const content = readFileSync(filePath, "utf-8");
  // Split on LF, then strip optional trailing CR (Windows CRLF → Unix LF compatibility).
  const lines = content.trim().split("\n").map(l => l.replace(/\r$/, "")).filter(l => l.trim());

  const { timestamp, provider, modelId } = parseReasonixFilename(filename);
  const sessionId = uuidv7();
  const entries: PiEntry[] = [];

  // 1. session header
  entries.push({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp,
    cwd,
    importedFrom: "reasonix",
  });

  // 2. model_change
  const modelChangeId = genEntryId();
  entries.push({
    type: "model_change",
    id: modelChangeId,
    parentId: null,
    timestamp,
    provider,
    modelId,
  });

  // 3. 转换对话内容
  let prevId: string = modelChangeId;

  for (const line of lines) {
    const result = convertReasonixLine(line, prevId, timestamp);
    if (!result || !result.entry) continue;
    entries.push(result.entry);
    prevId = result.entry.id!;
  }

  const messageCount = entries.filter(e => e.type === "message").length;

  return { entries, sessionId, messageCount };
}

/**
 * 将 pi entry 数组序列化为 JSONL 字符串
 */
export function serializePiEntries(entries: PiEntry[]): string {
  return entries.map(e => JSON.stringify(e)).join("\n") + "\n";
}
