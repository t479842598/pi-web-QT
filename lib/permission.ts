// ============================================================================
// Tool permission engine — ported from Reasonix (internal/permission).
// Decides per tool call: allow | ask | deny. Pure functions, no I/O, so the
// decision logic is trivially testable and reusable by both the RPC approval
// hook (server) and the settings editor (client).
//
// Rule syntax (mirrors Reasonix / Claude Code style):
//   - "ToolName"                    → matches every call to ToolName
//   - "ToolName(glob)"              → matches ToolName calls whose subject
//                                      matches the glob ("*" and "?")
//   - "ToolName=literal"            → matches subject by exact equality
//   - "Bash(command:*)"             → bash subject starts with "command:"
// Priority: deny > ask > allow. Nested/indirect bash execution (python -c,
// $(...), backticks, pipes into sh) always classifies as ask.
// ============================================================================

import { READ_ONLY_TOOL_NAMES } from "./modes";

export type Decision = "allow" | "ask" | "deny";

export interface Rule {
  tool: string;
  /** Empty subject matches every call to the tool. */
  subject?: string;
  /** Literal matches subject by exact equality, not glob. */
  literal?: boolean;
}

export interface Policy {
  allow: Rule[];
  ask: Rule[];
  deny: Rule[];
}

export function isDecision(value: unknown): value is Decision {
  return value === "allow" || value === "ask" || value === "deny";
}

// ---------------------------------------------------------------------------
// Rule parsing
// ---------------------------------------------------------------------------

/** Parse "ToolName", "ToolName(glob)", "ToolName=literal". Returns null when malformed. */
export function parseRule(input: string): Rule | null {
  const s = input.trim();
  if (!s) return null;
  // Legacy "ToolName=literal" — the '=' precedes any '('.
  const eq = s.indexOf("=");
  const paren = s.indexOf("(");
  if (eq > 0 && (paren < 0 || eq < paren)) {
    const tool = s.slice(0, eq).trim();
    if (!tool) return null;
    return { tool, subject: s.slice(eq + 1), literal: true };
  }
  if (paren >= 0 && s.endsWith(")")) {
    const tool = s.slice(0, paren).trim();
    if (!tool) return null;
    return { tool, subject: s.slice(paren + 1, -1) };
  }
  return { tool: s };
}

/** Parse an array of rule strings, dropping malformed entries. */
export function parseRules(input: string[] | undefined): Rule[] {
  if (!input) return [];
  const out: Rule[] = [];
  for (const s of input) {
    const r = parseRule(s);
    if (r) out.push(r);
  }
  return out;
}

export function ruleToString(rule: Rule): string {
  if (rule.subject === undefined) return rule.tool;
  return rule.literal ? `${rule.tool}=${rule.subject}` : `${rule.tool}(${rule.subject})`;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (const ch of pattern) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}

function hasGlobMeta(subject: string): boolean {
  return subject.includes("*") || subject.includes("?");
}

function subjectMatches(subject: string, rule: Rule): boolean {
  if (rule.subject === undefined) return true;
  if (subject === "") return false;
  if (rule.literal || !hasGlobMeta(rule.subject)) return subject === rule.subject;
  return globToRegExp(rule.subject).test(subject);
}

function ruleToolMatches(ruleTool: string, toolName: string): boolean {
  return ruleTool.toLowerCase() === toolName.toLowerCase();
}

function matchAny(rules: Rule[], toolName: string, subject: string): boolean {
  for (const r of rules) {
    if (ruleToolMatches(r.tool, toolName) && subjectMatches(subject, r)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Bash subject extraction & classification
// ---------------------------------------------------------------------------

/**
 * Extract the stable approval subject for a tool call. Mirrors Reasonix
 * Subjects(): file tools use source/destination paths; bash uses the full
 * command prefixed with "command:".
 */
export function extractSubject(toolName: string, args: unknown): string {
  if (toolName.toLowerCase() === "bash") {
    const cmd = (args as Record<string, unknown> | null | undefined)?.command;
    return typeof cmd === "string" && cmd.trim() ? `command:${cmd.trim()}` : "";
  }
  const m = (args as Record<string, unknown> | null | undefined) ?? {};
  const src = typeof m.source_path === "string" ? m.source_path : "";
  const dst = typeof m.destination_path === "string" ? m.destination_path : "";
  if (src && dst) return dst !== src ? `${src}\u0000${dst}` : src;
  const subjectKeys = ["path", "file_path", "file", "glob", "pattern", "directory"];
  for (const k of subjectKeys) {
    const v = m[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

/**
 * Nested / indirect execution needs a human even in auto mode. Mirrors
 * Reasonix classifyBashApproval → bashApprovalRequireHuman for the common
 * cases: command substitution, backticks, `python -c`, `sh -c`, pipes into
 * another interpreter, and multi-command chaining with `;` / `&&` / `|`.
 */
export function bashRequiresHuman(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  if (/\$\(/.test(cmd)) return true;            // $(...)
  if (/`/.test(cmd)) return true;               // backticks
  if (/(^|\s)(python|python3|node|ruby|perl|php)\s+-[a-z]*c(\s|$)/i.test(cmd)) return true;
  if (/(^|\s)(sh|bash|zsh)\s+-c(\s|$)/i.test(cmd)) return true;
  if (/(^|\s)(sudo|su)\s/i.test(cmd)) return true;
  // Chained execution is conservative: it may hide a write behind a read.
  if (/;\s*[a-z]/i.test(cmd)) return true;
  if (/\|\s*(sh|bash|zsh|python|python3|node)\b/i.test(cmd)) return true;
  if (/\|\s*tee\b/i.test(cmd)) return true;
  return false;
}

const READONLY_BASH_PREFIXES = [
  "ls", "cat", "head", "tail", "grep", "rg", "find", "wc", "echo", "pwd",
  "cd", "git status", "git diff", "git log", "git branch", "git remote",
  "git stash list", "git show", "git ls-files", "which", "type", "env",
  "file", "stat", "du", "df", "history", "man", "less", "more", "tree",
  "git diff --", "git log --", "curl -I", "curl --head",
];

/** A plain, single, read-only bash command (no chaining) is safe to allow. */
export function bashIsPlainReadonly(command: string): boolean {
  const cmd = command.trim();
  if (!cmd || bashRequiresHuman(cmd)) return false;
  if (/[;&|>]/.test(cmd)) return false; // chaining, redirects, pipes
  const lower = cmd.toLowerCase();
  for (const p of READONLY_BASH_PREFIXES) {
    if (lower === p || lower.startsWith(p + " ")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export interface DecideOptions {
  /** Mode fallback when no rule matches and the tool is a writer. */
  mode?: "ask" | "auto" | "yolo";
  /** True when the tool has no side effects (read/grep/find/ls/...). */
  readOnly?: boolean;
  /** Raw tool-call arguments (may be undefined for argument-less calls). */
  args?: unknown;
}

/**
 * Core decision: deny > ask > allow. Mirrors Reasonix DecideSubject.
 *
 * @param policy    rules from settings
 * @param toolName  tool being called
 * @param opts      mode, readOnly flag, args
 */
export function decide(policy: Policy, toolName: string, opts: DecideOptions = {}): Decision {
  const mode = opts.mode ?? "auto";
  const readOnly = opts.readOnly ?? READ_ONLY_TOOL_NAMES.has(toolName.toLowerCase());
  const args = opts.args;
  const subject = extractSubject(toolName, args);
  const isBash = toolName.toLowerCase() === "bash";
  const command = isBash && subject.startsWith("command:") ? subject.slice("command:".length) : "";

  // deny wins in every mode (including yolo).
  if (matchAny(policy.deny, toolName, subject)) return "deny";

  // Bash command classification drives the fallback below.
  if (isBash && command) {
    // Explicit allow rules with exact/glob subjects still win over the
    // heuristic classification, but only for plain commands (mirrors
    // matchAnyAllow refusing glob-allow for nested bash).
    const requiresHuman = bashRequiresHuman(command);
    if (matchAny(policy.allow, toolName, subject) && !requiresHuman) return "allow";
    if (matchAny(policy.ask, toolName, subject)) return "ask";
    if (requiresHuman) {
      // Nested execution: allow only if there is an exact (literal) allow rule.
      const exactAllow = policy.allow.some(
        (r) => ruleToolMatches(r.tool, toolName) && r.subject !== undefined && !hasGlobMeta(r.subject) && subjectMatches(subject, r),
      );
      if (exactAllow) return "allow";
      return mode === "yolo" ? "allow" : "ask";
    }
    if (bashIsPlainReadonly(command)) return "allow";
    // Ordinary write-ish command: mode decides (auto allows, ask asks).
    return mode === "ask" ? "ask" : "allow";
  }

  // Non-bash tools.
  if (matchAny(policy.allow, toolName, subject)) return "allow";
  if (matchAny(policy.ask, toolName, subject)) return "ask";
  if (readOnly) return "allow";
  // Writer with no explicit rule: mode decides.
  return mode === "ask" ? "ask" : "allow";
}

// ---------------------------------------------------------------------------
// Defaults & settings binding
// ---------------------------------------------------------------------------

/**
 * Default policy: writers ask by default, read-only tools are always allowed,
 * and a few dangerous bash patterns are denied outright.
 */
export function defaultPolicy(): Policy {
  return {
    deny: [],
    ask: [],
    allow: [],
  };
}

export function policyFromStrings(input: {
  allow?: string[];
  ask?: string[];
  deny?: string[];
} | undefined): Policy {
  return {
    allow: parseRules(input?.allow),
    ask: parseRules(input?.ask),
    deny: parseRules(input?.deny),
  };
}

export function policyToStrings(policy: Policy): { allow: string[]; ask: string[]; deny: string[] } {
  return {
    allow: policy.allow.map(ruleToString),
    ask: policy.ask.map(ruleToString),
    deny: policy.deny.map(ruleToString),
  };
}

export { READ_ONLY_TOOL_NAMES };
