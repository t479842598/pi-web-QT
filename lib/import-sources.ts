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

/** Reasonix 平铺会话目录（Windows/CLI 布局：~/.reasonix/sessions/*.jsonl） */
export function reasonixSessionsFlatDir(): string {
  return join(homedir(), ".reasonix", "sessions");
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

const PI_SESSIONS_DIR = join(getAgentDir(), "sessions");

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
  const reasonixAvailable =
    existsSync(reasonixProjectsDir()) || existsSync(reasonixSessionsFlatDir());
  return [
    {
      key: "reasonix",
      label: "Reasonix",
      available: reasonixAvailable,
      status: reasonixAvailable ? "available" : "unavailable",
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

/**
 * 解析一个 Reasonix 项目名的会话目录与文件列表。
 * 优先 projects/<name>/sessions/（mac 布局），回退到平铺目录中 "<name>-" 前缀文件（Windows/CLI 布局）。
 * projectName 来自请求体（POST /api/import/execute），此处拒绝路径分隔符与
 * "." / ".." 段，防止路径穿越逃出 ~/.reasonix。
 */
export function reasonixProjectSessions(
  projectName: string,
): { sessionsDir: string; files: string[]; flat: boolean } | null {
  if (
    !projectName ||
    projectName.split(/[\\/]/).some((seg) => seg === "" || seg === "." || seg === "..")
  ) {
    return null;
  }
  const projectsDir = join(reasonixProjectsDir(), projectName, "sessions");
  if (existsSync(projectsDir)) {
    try {
      const files = readdirSync(projectsDir).filter(isReasonixMainSession);
      return { sessionsDir: projectsDir, files, flat: false };
    } catch {
      return null;
    }
  }
  const flatDir = reasonixSessionsFlatDir();
  if (existsSync(flatDir)) {
    try {
      const prefix = `${projectName}-`;
      const files = readdirSync(flatDir).filter(
        (f) => isReasonixMainSession(f) && f.startsWith(prefix),
      );
      if (files.length > 0) return { sessionsDir: flatDir, files, flat: true };
    } catch {
      return null;
    }
  }
  return null;
}

/** 扫描 Reasonix 项目及可导入会话（projects 布局 + 平铺 sessions 布局） */
export function discoverReasonix(): ReasonixDiscoverResult {
  const projectsDir = reasonixProjectsDir();
  const flatDir = reasonixSessionsFlatDir();
  if (!existsSync(projectsDir) && !existsSync(flatDir)) {
    return { available: false, projects: [], totalSessions: 0 };
  }

  const projects: ReasonixProjectPreview[] = [];
  let total = 0;
  const seen = new Set<string>();

  // 1) projects/<name>/sessions/*.jsonl 布局
  if (existsSync(projectsDir)) {
    let projectNames: string[];
    try {
      projectNames = readdirSync(projectsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      projectNames = [];
    }

    for (const name of projectNames) {
      const found = reasonixProjectSessions(name);
      if (!found || found.files.length === 0) continue;
      seen.add(name);
      const piCwdDir = reasonixProjectToPiCwdDir(name);
      const matched = piProjectExists(piCwdDir);
      projects.push({
        name,
        sessions: found.files.length,
        piCwdDir,
        matched,
        existingCount: matched ? piSessionCount(piCwdDir) : 0,
      });
      total += found.files.length;
    }
  }

  // 2) 平铺 sessions/*.jsonl 布局：按文件名前缀（第一个 "-" 前）分组
  if (existsSync(flatDir)) {
    let files: string[];
    try {
      files = readdirSync(flatDir).filter(isReasonixMainSession);
    } catch {
      files = [];
    }
    const byPrefix = new Map<string, number>();
    for (const f of files) {
      const prefix = f.split("-")[0];
      if (!prefix) continue;
      byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
    }
    for (const [prefix, count] of byPrefix) {
      if (seen.has(prefix)) continue; // 与 projects 布局重名时以 projects 布局为准
      const piCwdDir = reasonixProjectToPiCwdDir(prefix);
      const matched = piProjectExists(piCwdDir);
      projects.push({
        name: prefix,
        sessions: count,
        piCwdDir,
        matched,
        existingCount: matched ? piSessionCount(piCwdDir) : 0,
      });
      total += count;
    }
  }

  return { available: true, projects, totalSessions: total };
}
