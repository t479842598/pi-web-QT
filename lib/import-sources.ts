/**
 * 外部工具导入源发现 — 跨平台路径解析 + 项目/会话扫描
 *
 * 支持的导入源：
 * - reasonix: ~/.reasonix/projects/<project>/sessions/*.jsonl
 * - codex:    ~/.codex/sessions/<YYYY>/<MM>/<DD>/<file>.jsonl    (后续)
 * - opencode: ~/.opencode/sessions/                               (后续)
 * - claude:   ~/.claude/sessions/                                 (后续)
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, readdirSync, statSync } from "fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionHeader } from "./types";
import { readSessionHeader } from "./session-reader";

// ============================================================================
// 路径解析
// ============================================================================

/** Reasonix 项目根目录（跨平台） */
export function reasonixProjectsDir(): string {
  return join(homedir(), ".reasonix", "projects");
}

/** Codex 会话目录（跨平台） */
export function codexSessionsDir(): string {
  return join(homedir(), ".codex", "sessions");
}

/** OpenCode 会话目录（跨平台，后续） */
export function opencodeSessionsDir(): string {
  return join(homedir(), ".opencode", "sessions");
}

/** Claude 会话目录（跨平台，后续） */
export function claudeSessionsDir(): string {
  return join(homedir(), ".claude", "sessions");
}

// ============================================================================
// Reasonix 文件过滤
// ============================================================================

/** 非主对话的附属文件后缀 */
const REASONIX_SKIP_SUFFIXES = [
  ".events.jsonl", ".conflicts.jsonl", ".telemetry.json",
  ".recovery.json", ".goal-state.json", ".event-index.json",
  ".recovery.jsonl", ".ckpt", ".meta", ".lock", ".lease.json",
  ".lease.lock", ".jobs",
];

function isReasonixMainSession(filename: string): boolean {
  if (!filename.endsWith(".jsonl")) return false;
  for (const suffix of REASONIX_SKIP_SUFFIXES) {
    if (filename.endsWith(suffix)) return false;
  }
  return true;
}

// ============================================================================
// Reasonix 项目目录名 → pi cwd 目录名
// ============================================================================

/**
 * Reasonix: -Applications → pi: --Applications--
 * Reasonix: -Volumes-1T 原装-项目研发-pi-web-QT → pi: --Volumes-1T 原装-项目研发-pi-web-QT--
 */
export function reasonixProjectToPiCwdDir(projectName: string): string {
  const inner = projectName.replace(/^-/, "");
  return `--${inner}--`;
}

// ============================================================================
// pi 会话目录 → 发现匹配
// ============================================================================

const PI_SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

function piProjectExists(piCwdDir: string): boolean {
  return existsSync(join(PI_SESSIONS_DIR, piCwdDir));
}

function piSessionCount(piCwdDir: string): number {
  try {
    const files = readdirSync(join(PI_SESSIONS_DIR, piCwdDir));
    return files.filter(f => f.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

// ============================================================================
// 源信息类型
// ============================================================================

export interface ImportSourceInfo {
  key: string;               // "reasonix" | "codex" | "opencode" | "claude"
  label: string;             // 显示名称
  available: boolean;        // 源目录是否存在
  status: "available" | "unavailable" | "coming-soon";
}

export interface ReasonixProjectPreview {
  name: string;              // Reasonix 项目名（如 "-Volumes-..."）
  sessions: number;          // 可导入的 session 数量
  piCwdDir: string;          // 对应的 pi 目录名
  matched: boolean;          // pi 是否已有同名项目
  existingCount: number;     // pi 已有 session 数量
}

export interface ReasonixDiscoverResult {
  available: boolean;
  projects: ReasonixProjectPreview[];
  totalSessions: number;
}

// ============================================================================
// 发现函数
// ============================================================================

/** 列出所有支持的导入源及状态 */
export function listImportSources(): ImportSourceInfo[] {
  return [
    {
      key: "reasonix",
      label: "Reasonix",
      available: existsSync(reasonixProjectsDir()),
      status: existsSync(reasonixProjectsDir()) ? "available" : "unavailable",
    },
    {
      key: "codex",
      label: "Codex",
      available: false,
      status: "coming-soon",
    },
    {
      key: "opencode",
      label: "OpenCode",
      available: false,
      status: "coming-soon",
    },
    {
      key: "claude",
      label: "Claude Code",
      available: false,
      status: "coming-soon",
    },
  ];
}

/** 扫描 Reasonix 项目及可导入会话 */
export function discoverReasonix(): ReasonixDiscoverResult {
  const dir = reasonixProjectsDir();
  if (!existsSync(dir)) {
    return { available: false, projects: [], totalSessions: 0 };
  }

  let projectNames: string[];
  try {
    projectNames = readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return { available: false, projects: [], totalSessions: 0 };
  }

  const projects: ReasonixProjectPreview[] = [];
  let total = 0;

  for (const name of projectNames) {
    const sessionsDir = join(dir, name, "sessions");
    let sessions: string[];
    try {
      sessions = readdirSync(sessionsDir).filter(isReasonixMainSession);
    } catch {
      continue;
    }
    if (sessions.length === 0) continue;

    const piCwdDir = reasonixProjectToPiCwdDir(name);
    const matched = piProjectExists(piCwdDir);
    projects.push({
      name,
      sessions: sessions.length,
      piCwdDir,
      matched,
      existingCount: matched ? piSessionCount(piCwdDir) : 0,
    });
    total += sessions.length;
  }

  return { available: true, projects, totalSessions: total };
}
