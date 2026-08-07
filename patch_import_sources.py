# -*- coding: utf-8 -*-
# ⚠️ 警告：本脚本只覆盖 APPDATA 适配中的 2 个函数（reasonixProjectSessions / discoverReasonix）。
# 完整适配还包括 reasonixHomeDirs() 定义、reasonixProjectsDir/reasonixSessionsFlatDir 多根遍历、
# 文件头 docstring 与 import 精简（删 statSync/SessionHeader/readSessionHeader）。
# 单独运行本脚本会产生引用未定义函数 reasonixHomeDirs 的坏文件！
# 完整恢复：git restore --source=backup/pre-reset-20260807 --worktree -- lib/import-sources.ts
# 方案文档：docs/reasonix-import-adaptation.md
import io

path = 'lib/import-sources.ts'
with open(path, 'rb') as f:
    raw = f.read()
text = raw.decode('utf-8')
had_crlf = '\r\n' in text
text = text.replace('\r\n', '\n')

old1 = """/**
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
    projectName.split(/[\\\\/]/).some((seg) => seg === "" || seg === "." || seg === "..")
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
}"""

new1 = """/**
 * 解析一个 Reasonix 项目名的会话目录与文件列表。
 * 优先 projects/<name>/sessions/（mac/Windows 桌面版布局），回退到平铺目录中 "<name>-" 前缀文件（Windows/CLI 布局）。
 * 遍历所有候选数据根目录（%APPDATA%/reasonix 与 ~/.reasonix）。
 * projectName 来自请求体（POST /api/import/execute），此处拒绝路径分隔符与
 * "." / ".." 段，防止路径穿越逃出 reasonix 数据根目录。
 */
export function reasonixProjectSessions(
  projectName: string,
): { sessionsDir: string; files: string[]; flat: boolean } | null {
  if (
    !projectName ||
    projectName.split(/[\\\\/]/).some((seg) => seg === "" || seg === "." || seg === "..")
  ) {
    return null;
  }
  // 1) projects/<name>/sessions/ 布局（所有候选根目录）
  for (const home of reasonixHomeDirs()) {
    const projectsDir = join(home, "projects", projectName, "sessions");
    if (existsSync(projectsDir)) {
      try {
        const files = readdirSync(projectsDir).filter(isReasonixMainSession);
        return { sessionsDir: projectsDir, files, flat: false };
      } catch {
        return null;
      }
    }
  }
  // 2) 平铺 sessions/*.jsonl 布局（所有候选根目录）
  for (const home of reasonixHomeDirs()) {
    const flatDir = join(home, "sessions");
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
  }
  return null;
}"""

if old1 not in text:
    print("OLD1 NOT FOUND")
    raise SystemExit(1)
text = text.replace(old1, new1, 1)

old2 = """/** 扫描 Reasonix 项目及可导入会话（projects 布局 + 平铺 sessions 布局） */
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
}"""

new2 = """/** 扫描 Reasonix 项目及可导入会话（projects 布局 + 平铺 sessions 布局，遍历所有候选数据根目录） */
export function discoverReasonix(): ReasonixDiscoverResult {
  const homes = reasonixHomeDirs();
  const projectDirs = homes
    .map((home) => join(home, "projects"))
    .filter((p) => existsSync(p));
  const flatDirs = homes
    .map((home) => join(home, "sessions"))
    .filter((p) => existsSync(p));
  if (projectDirs.length === 0 && flatDirs.length === 0) {
    return { available: false, projects: [], totalSessions: 0 };
  }

  const projects: ReasonixProjectPreview[] = [];
  let total = 0;
  const seen = new Set<string>();

  // 1) projects/<name>/sessions/*.jsonl 布局（所有候选根目录）
  for (const projectsDir of projectDirs) {
    let projectNames: string[];
    try {
      projectNames = readdirSync(projectsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      projectNames = [];
    }

    for (const name of projectNames) {
      if (seen.has(name)) continue;
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

  // 2) 平铺 sessions/*.jsonl 布局：按文件名前缀（第一个 "-" 前）分组（所有候选根目录）
  for (const flatDir of flatDirs) {
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
}"""

if old2 not in text:
    print("OLD2 NOT FOUND")
    raise SystemExit(1)
text = text.replace(old2, new2, 1)

if had_crlf:
    text = text.replace('\n', '\r\n')
with open(path, 'wb') as f:
    f.write(text.encode('utf-8'))
print("OK")
