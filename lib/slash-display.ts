/**
 * 斜杠命令展开消息的展示还原工具。
 *
 * 背景：SDK (pi-coding-agent) 在 prompt() 入口把 /skill:name args 与 /模板名 args
 * 展开为完整文本（skill 正文 / 模板正文 + 参数替换）写入 session JSONL，
 * pi-web 界面因此会看到大段展开文本。本模块把这些展开文本还原为紧凑的
 * 命令调用形式（如 `/skill:hello 123132`），供界面展示与交互使用。
 *
 * 约束：不修改 SDK、不修改 JSONL 存储 —— 模型输入与存储层保持展开文本，
 * 本模块仅作用于 pi-web 的展示层。
 */

/** SDK _expandSkillCommand 展开文本的特征前缀（skill 名称与路径为必选属性） */
const SKILL_OPEN_RE = /^<skill name="([^"]+)" location="([^"]+)">/;

/** SDK 展开时 skill 闭合标签，其后紧跟 `\n\n` 与参数（如有） */
const SKILL_CLOSE_TAG = "\n</skill>";

/**
 * 解析斜杠命令名。
 * `/hello 123` → "hello"，`/skill:review src/main.go` → "skill:review"，
 * 非 `/` 开头的文本返回 null（`!` bash 命令同样不匹配）。
 */
export function parseSlashCommandName(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const rest = trimmed.slice(1);
  if (!rest) return null;
  const spaceIdx = rest.search(/\s/);
  return spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
}

/**
 * 将 skill 展开文本还原为命令形式 `/skill:name args`。
 * 展开格式（对齐 SDK _expandSkillCommand）：
 *   <skill name="..." location="...">\nReferences are relative to ...\n\n<body>\n</skill>
 *   可选后缀 `\n\n<args>`
 * 非 skill 展开文本返回 null。
 */
export function skillExpansionToCommand(text: string): string | null {
  const open = text.match(SKILL_OPEN_RE);
  if (!open) return null;
  const name = open[1];
  const closeIdx = text.indexOf(SKILL_CLOSE_TAG);
  let args = "";
  if (closeIdx !== -1) {
    const rest = text.slice(closeIdx + SKILL_CLOSE_TAG.length);
    if (rest.startsWith("\n\n")) args = rest.slice(2).trim();
  }
  return args ? `/skill:${name} ${args}` : `/skill:${name}`;
}

/**
 * 提取 user 消息的纯文本（兼容 string 与 blocks 两种 content 形式）。
 * 多块文本以 \n 拼接，与 MessageView 的现有拼接逻辑一致。
 */
export function userMessagePlainText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  // 与 MessageView 的拼接逻辑一致：过滤非文本块后以 \n 拼接
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

/**
 * 尝试把一条 user 消息文本还原为紧凑命令展示。
 * - 未展开的命令（原文以 / 开头）→ 原样返回
 * - skill 展开文本 → 还原为 /skill:name args
 * - 其他（普通文本、prompt 模板展开 —— 无特征标记）→ null，保持全文展示
 */
export function resolveSlashDisplayText(text: string): string | null {
  if (!text || !text.trim()) return null;
  if (text.trim().startsWith("/")) return text;
  return skillExpansionToCommand(text);
}

/**
 * FIFO 跟踪器：记录已发送的、确定会被 SDK 展开的斜杠命令原文，
 * 待对应 user 消息回传（message_end）时按发送顺序消费并注入。
 * 仅当命令命中 prompt 模板或 skill 时才 push（见 rpc-manager send()），
 * 因此栈内记录必定展开，回传文本与原文不同。
 */
export class SlashOriginalTracker {
  private queue: string[] = [];

  push(original: string): void {
    this.queue.push(original);
  }

  get size(): number {
    return this.queue.length;
  }

  /** 清空队列（prompt 发送失败等场景，避免残留记录错注入后续消息） */
  clear(): void {
    this.queue.length = 0;
  }

  /**
   * 为回传的 user 消息消费一条记录。
   * 返回应注入的原始命令；栈空或回传文本与栈顶原文相同（未展开的防御分支）
   * 时返回 null。
   */
  consumeFor(text: string): string | null {
    if (this.queue.length === 0) return null;
    const top = this.queue.shift()!;
    return top === text ? null : top;
  }
}
