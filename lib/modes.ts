// ============================================================================
// Chat modes — ported from Reasonix (esengine/DeepSeek-Reasonix).
// Three independent mode axes drive the composer:
//   - CollaborationMode: 常规 / 计划 / 目标  (normal | plan | goal)
//   - TokenMode:         轻量 / 均衡 / 交付  (economy | full | delivery)
//   - ToolApprovalMode:  需要批准 / 自动批准 / Yolo (ask | auto | yolo)
// Modes are normalized defensively (unknown values fall back to defaults) so
// stale persisted settings can never break the app.
// ============================================================================

export type CollaborationMode = "normal" | "plan" | "goal";
export type TokenMode = "full" | "economy" | "delivery";
export type ToolApprovalMode = "ask" | "auto" | "yolo";

export const COLLABORATION_MODES: readonly CollaborationMode[] = ["normal", "plan", "goal"];
export const TOKEN_MODES: readonly TokenMode[] = ["full", "economy", "delivery"];
export const TOOL_APPROVAL_MODES: readonly ToolApprovalMode[] = ["ask", "auto", "yolo"];

export const DEFAULT_COLLABORATION_MODE: CollaborationMode = "normal";
export const DEFAULT_TOKEN_MODE: TokenMode = "full";
export const DEFAULT_TOOL_APPROVAL_MODE: ToolApprovalMode = "auto";

/** Persisted mode & permission settings (safe for client import). */
export interface ModeSettings {
  collaborationMode: CollaborationMode;
  tokenMode: TokenMode;
  toolApprovalMode: ToolApprovalMode;
  /** Permission rules — "allow" | "ask" | "deny" rule-string arrays. */
  permissionRules: { allow: string[]; ask: string[]; deny: string[] };
}

export function defaultModeSettings(): ModeSettings {
  return {
    collaborationMode: DEFAULT_COLLABORATION_MODE,
    tokenMode: DEFAULT_TOKEN_MODE,
    toolApprovalMode: DEFAULT_TOOL_APPROVAL_MODE,
    permissionRules: { allow: [], ask: [], deny: [] },
  };
}

// ---------------------------------------------------------------------------
// Normalizers — unknown/legacy values fall back to the safe default.
// ---------------------------------------------------------------------------

export function normalizeCollaborationMode(value: unknown): CollaborationMode {
  if (value === "normal" || value === "plan" || value === "goal") return value;
  return DEFAULT_COLLABORATION_MODE;
}

export function normalizeTokenMode(value: unknown): TokenMode {
  // Reasonix aliases: "save" | "saving" | "low" | "lite" | "minimal" → economy;
  // "deliver" | "quality" | "performance" → delivery. Keep the canonical set.
  if (value === "economy" || value === "delivery" || value === "full") return value;
  return DEFAULT_TOKEN_MODE;
}

export function normalizeToolApprovalMode(value: unknown): ToolApprovalMode {
  if (value === "ask" || value === "auto" || value === "yolo") return value;
  return DEFAULT_TOOL_APPROVAL_MODE;
}

// ---------------------------------------------------------------------------
// Economy tool whitelist — mirrors Reasonix tokenEconomyCoreBuiltins. Only
// these tools stay enabled in economy mode; the agent is told to work direct.
// ---------------------------------------------------------------------------

export const ECONOMY_TOOL_WHITELIST: readonly string[] = [
  "bash",
  "edit",
  "edit_file",
  "grep",
  "find",
  "kill_shell",
  "ls",
  "read",
  "update_goal",
  "wait",
  "write",
  "write_file",
];

/** Built-in read-only tools that never need approval (deny rules still win). */
export const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "bash_output",
  "get_tools",
  "get_commands",
  "get_session_stats",
]);

// ---------------------------------------------------------------------------
// Prompt blocks — injected ahead of the user message so the mode reaches the
// agent without touching the visible textarea content.
// ---------------------------------------------------------------------------

const PLAN_MODE_BLOCK =
  `You are in PLAN MODE. Work as a read-only planning assistant.\n` +
  `- Analyze, read, search and reason about the codebase; do NOT modify any files.\n` +
  `- Do NOT run shell commands that mutate state, install packages, or start servers.\n` +
  `- When you have enough understanding, produce a concrete, step-by-step implementation plan.\n` +
  `- Structure the plan with clear phases, the files involved, and any risks or open questions.\n` +
  `- Do not write code yet — the plan itself is the deliverable.`;

const ECONOMY_MODE_BLOCK =
  `<economy-profile>\n` +
  `Economy mode is on. Keep work direct and use the core file and shell tools only.\n` +
  `Minimize context: skip exploratory reads you do not need, avoid re-reading files you already have,\n` +
  `and do not pad responses with extra explanation or tool round-trips.\n` +
  `</economy-profile>`;

const DELIVERY_MODE_BLOCK =
  `<delivery-profile>\n` +
  `Prioritize a verified, complete result over minimizing model calls or tokens.\n` +
  `For action requests: establish acceptance criteria; reproduce bugs when practical;\n` +
  `inspect the relevant code and project rules; fix the root cause; run focused\n` +
  `verification; review the resulting diff and adjacent behavior; and continue until\n` +
  `the request is complete or a genuine blocker remains. Do not claim success without\n` +
  `evidence. State any unverified result or assumption explicitly.\n` +
  `</delivery-profile>`;

/** Injected when a goal run starts so the agent knows the contract up front. */
const GOAL_MODE_BLOCK =
  `<goal-profile>\n` +
  `You are working toward a stated goal. Do the next useful work each turn.\n` +
  `At the end of each turn report your disposition explicitly:\n` +
  `- "continue" with the next concrete step, when more work remains;\n` +
  `- "complete" only when the goal is fully done and verified;\n` +
  `- "blocked" when only the user can unblock you.\n` +
  `</goal-profile>`;

export interface ModeSystemPromptOptions {
  collaborationMode: CollaborationMode;
  tokenMode: TokenMode;
  /** Active goal text — appended when collaborationMode is "goal". */
  goalText?: string;
}

/**
 * Build the mode instruction block for a user prompt. Blocks are combined in a
 * stable order (plan → token profile → goal) and separated by blank lines.
 * Returns "" when no mode needs injection (normal + full).
 */
export function buildModeSystemPrompt(options: ModeSystemPromptOptions): string {
  const blocks: string[] = [];
  if (options.collaborationMode === "plan") blocks.push(PLAN_MODE_BLOCK);
  if (options.tokenMode === "economy") blocks.push(ECONOMY_MODE_BLOCK);
  if (options.tokenMode === "delivery") blocks.push(DELIVERY_MODE_BLOCK);
  if (options.collaborationMode === "goal") {
    const goalText = options.goalText?.trim();
    blocks.push(goalText ? `${GOAL_MODE_BLOCK}\n\nGoal: ${goalText}` : GOAL_MODE_BLOCK);
  }
  return blocks.join("\n\n");
}

/**
 * Strip every injected mode-instruction block from a prompt/message so the
 * visible bubble, edit re-fill, or session title shows only what the user
 * typed. Handles all block forms produced by buildModeSystemPrompt (and the
 * legacy PLAN MODE prefix): <economy-profile>/<delivery-profile>/
 * <goal-profile> XML blocks and the "You are in PLAN MODE." heading block.
 * Blocks may be stacked (plan + token + goal) and/or carry trailing text
 * ("Goal: …"); a lone prompt whose ENTIRE content is a block yields "".
 */
export function stripModeInstructionBlocks(text: string): string {
  if (!text) return text;
  let value = text.replace(/^\uFEFF/, "");
  // XML profile blocks (non-greedy across lines; block may contain newlines).
  // A goal block may carry a "Goal: …" trailer line directly after the close
  // tag — fold it into the same removal so no injected text survives.
  value = value.replace(/<(?:economy|delivery|goal)-profile>\n?[\s\S]*?<\/(?:economy|delivery|goal)-profile>\n*(?:Goal:\s*[^\n]*\n?)?/g, "");
  // Legacy plan heading block: heading line + instruction list up to the
  // first blank line that separates it from the user's own text.
  value = value.replace(/^You are in PLAN MODE\.[\s\S]*?\n(?=\n|$)/, "");
  // Collapse the separator blank lines left behind when all blocks are gone.
  return value.replace(/^\s*\n/, "").trimStart();
}
