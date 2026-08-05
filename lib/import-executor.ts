/**
 * 导入编排器 — 异步 job 管理 + 文件写入
 *
 * 使用 globalThis 存储进行中的 job（Next.js hot-reload 安全）。
 * 导入时：遍历 Reasonix 项目 → 逐个 session 转换 → 写入 pi 目录 → 更新进度。
 */

import { join } from "path";
import { homedir } from "os";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { reasonixProjectSessions, reasonixProjectToPiCwdDir } from "./import-sources";
import { convertReasonixFile, serializePiEntries } from "./import-reasonix";
import { invalidateSessionListCache } from "./session-reader";

// ============================================================================
// Job 类型
// ============================================================================

export interface ImportJob {
  jobId: string;
  source: string;
  total: number;
  imported: number;
  skipped: number;
  errors: number;
  currentFile: string;
  done: boolean;
  sessionIds: string[];
  createdAt: number;
}

declare global {
  var __piImportJobs: Map<string, ImportJob> | undefined;
}

function getJobs(): Map<string, ImportJob> {
  if (!globalThis.__piImportJobs) globalThis.__piImportJobs = new Map();
  return globalThis.__piImportJobs;
}

const PI_SESSIONS_DIR = join(getAgentDir(), "sessions");
const JOB_TTL_MS = 30 * 60 * 1000; // 30 min

// ============================================================================
// 导入执行
// ============================================================================

/**
 * 启动异步导入
 * @returns jobId，前端用这个轮询 progress
 */
export function startReasonixImport(
  projectNames: string[],
): { jobId: string } {
  const jobId = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 计算总数
  let total = 0;
  const filesByProject: Array<{ projectName: string; piCwdDir: string; files: string[]; flat: boolean }> = [];

  for (const projectName of projectNames) {
    const found = reasonixProjectSessions(projectName);
    if (!found || found.files.length === 0) continue;
    const piCwdDir = reasonixProjectToPiCwdDir(projectName);
    filesByProject.push({ projectName, piCwdDir, files: found.files, flat: found.flat });
    total += found.files.length;
  }

  const job: ImportJob = {
    jobId,
    source: "reasonix",
    total,
    imported: 0,
    skipped: 0,
    errors: 0,
    currentFile: "",
    done: false,
    sessionIds: [],
    createdAt: Date.now(),
  };
  getJobs().set(jobId, job);

  // 异步执行导入
  runReasonixImport(job, filesByProject).catch(err => {
    console.error("[import-reasonix] Fatal:", err);
    job.done = true;
  });

  return { jobId };
}

async function runReasonixImport(
  job: ImportJob,
  filesByProject: Array<{ projectName: string; piCwdDir: string; files: string[]; flat: boolean }>,
): Promise<void> {
  for (const { projectName, piCwdDir, files, flat } of filesByProject) {
    const found = reasonixProjectSessions(projectName);
    if (!found) continue;
    const sessionsDir = found.sessionsDir;

    // 从已有 pi session 获取正确的 cwd（避免 - 转义歧义）
    // 优先从已有的 pi session 文件头读取 cwd，fallback 时才用路径名推导。
    let cwd: string;
    if (flat) {
      // 平铺会话（Windows/CLI）没有项目路径信息，默认用户主目录
      cwd = homedir();
    } else {
      const inner = projectName.replace(/^-/, "");
      if (process.platform === "win32") {
        // Windows: detect drive-letter pattern (e.g. "C-Users-me-project" → C:\Users\me\project)
        const segments = inner.split("-");
        if (segments.length >= 2 && /^[a-zA-Z]$/.test(segments[0])) {
          cwd = segments[0].toUpperCase() + ":\\" + segments.slice(1).join("\\");
        } else {
          cwd = "/" + inner.replace(/-/g, "/");
        }
      } else {
        cwd = "/" + inner.replace(/-/g, "/");
      }
    }
    try {
      const piDir = join(PI_SESSIONS_DIR, piCwdDir);
      const existing = readdirSync(piDir).filter(f => f.endsWith(".jsonl"));
      if (existing.length > 0) {
        const firstLine = readFileSync(join(piDir, existing[0]), "utf-8").split("\n")[0].replace(/\r$/, "");
        const parsed = JSON.parse(firstLine);
        if (parsed.cwd) cwd = parsed.cwd;
      }
    } catch { /* use fallback */ }

    const targetDir = join(PI_SESSIONS_DIR, piCwdDir);
    mkdirSync(targetDir, { recursive: true });

    for (const filename of files) {
      job.currentFile = filename;

      try {
        const sourcePath = join(sessionsDir, filename);

        // 生成 pi 文件名；平铺命名（无法从文件名取时间戳）用文件 mtime
        const safeTs = flat
          ? statSync(sourcePath).mtime.toISOString().slice(0, 19).replace(/[:.]/g, "-")
          : filename.slice(0, 19).replace(/[:.]/g, "-");

        const result = convertReasonixFile(sourcePath, cwd, filename);

        // 去重检查
        const existingFiles = readdirSync(targetDir);
        const duplicate = existingFiles.find(f =>
          f.includes(safeTs.split("-")[0]) &&
          f.endsWith(".jsonl"),
        );

        if (duplicate && result.messageCount === 0) {
          job.skipped++;
          continue;
        }

        if (result.messageCount === 0) {
          job.skipped++;
          continue;
        }

        const piFilename = `${safeTs}Z_${result.sessionId}.jsonl`;
        const piPath = join(targetDir, piFilename);

        // 跳过已存在的文件
        if (existsSync(piPath)) {
          job.skipped++;
          continue;
        }

        const jsonl = serializePiEntries(result.entries);
        writeFileSync(piPath, jsonl, "utf-8");

        job.imported++;
        job.sessionIds.push(result.sessionId);
      } catch (err) {
        job.errors++;
        console.error(`[import-reasonix] Error converting ${filename}:`, err);
      }

      // 让出事件循环，避免阻塞
      await new Promise(r => setImmediate(r));
    }
  }

  job.done = true;
  job.currentFile = "";

  // Session 列表缓存失效，下次刷新时 pi-web 自动感知新文件
  invalidateSessionListCache();

  // 清理 30min+ 的旧 job
  for (const [id, j] of getJobs()) {
    if (j.done && Date.now() - j.createdAt > JOB_TTL_MS) {
      getJobs().delete(id);
    }
  }
}

// ============================================================================
// 状态查询
// ============================================================================

export function getImportJob(jobId: string): ImportJob | null {
  return getJobs().get(jobId) ?? null;
}
