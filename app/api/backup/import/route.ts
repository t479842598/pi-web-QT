import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { getAgentDir, SettingsManager, DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import {
  adaptMcpConfig,
  cleanupParsedBackup,
  npmSpecsFromSettings,
  parseBackupZip,
  restoreBackup,
  type BackupPreview,
  type RestoreReport,
  type RestoreSelections,
} from "@/lib/backup";
import { parseFormDataWithinLimit } from "@/lib/bounded-form-data";
import { isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

/** Max upload: backups may include sessions history. */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** Preview tokens expire after this long; the client must re-upload afterwards. */
const BACKUP_TOKEN_TTL_MS = 30 * 60 * 1000;

/** Hard cap on concurrent preview buffers; oldest entry is evicted beyond this. */
const MAX_BUFFERED_BACKUPS = 16;

interface BackupBufferEntry {
  buffer: Buffer;
  expiresAt: number;
}

/**
 * In-flight backup buffers between preview (phase=parse) and confirm
 * (phase=restore). Survives hot reload like other globalThis registries.
 * Entries expire 30 minutes after parsing; expired entries are dropped lazily.
 */
const backupBuffers = (globalThis as { __piBackupBuffers?: Map<string, BackupBufferEntry> }).__piBackupBuffers ??= new Map<string, BackupBufferEntry>();

function getBackupBuffer(token: string): Buffer | null {
  const entry = backupBuffers.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    backupBuffers.delete(token);
    return null;
  }
  return entry.buffer;
}

function setBackupBuffer(buffer: Buffer): string {
  const token = randomUUID();
  backupBuffers.set(token, { buffer, expiresAt: Date.now() + BACKUP_TOKEN_TTL_MS });
  // Lazy cleanup of expired entries, then hard-cap eviction of the oldest.
  if (backupBuffers.size > MAX_BUFFERED_BACKUPS) {
    const now = Date.now();
    for (const [key, entry] of backupBuffers) {
      if (entry.expiresAt <= now) backupBuffers.delete(key);
    }
    while (backupBuffers.size > MAX_BUFFERED_BACKUPS) {
      let oldestKey: string | null = null;
      let oldestExpiry = Infinity;
      for (const [key, entry] of backupBuffers) {
        if (entry.expiresAt < oldestExpiry) {
          oldestExpiry = entry.expiresAt;
          oldestKey = key;
        }
      }
      if (oldestKey === null) break;
      backupBuffers.delete(oldestKey);
    }
  }
  return token;
}

function errorResponse(error: unknown, status = 400): NextResponse {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(req, MAX_UPLOAD_BYTES);
  } catch (error) {
    return errorResponse(error, 413);
  }

  const phase = String(formData.get("phase") ?? "parse");

  try {
    if (phase === "parse") {
      const file = formData.get("file");
      if (!(file instanceof File)) return errorResponse("file field required", 400);
      const buffer = Buffer.from(await file.arrayBuffer());

      const parsed = parseBackupZip(buffer);
      let preview: BackupPreview;
      try {
        const adapted = adaptMcpConfig(parsed.servers, parsed.binScripts);
        preview = {
          manifest: parsed.manifest,
          categories: parsed.categories,
          servers: adapted.servers,
          warnings: [...parsed.manifest.warnings, ...adapted.warnings],
          npmPackages: npmSpecsFromSettings(parsed),
        };
      } finally {
        cleanupParsedBackup(parsed);
      }

      const token = setBackupBuffer(buffer);
      return NextResponse.json({ phase: "preview", token, preview });
    }

    if (phase === "restore") {
      const token = String(formData.get("token") ?? "");
      const buffer = getBackupBuffer(token);
      if (!buffer) return errorResponse("Backup token expired — please upload the file again", 400);

      const selectionsRaw = String(formData.get("selections") ?? "");
      let selections: RestoreSelections;
      try {
        selections = JSON.parse(selectionsRaw) as RestoreSelections;
      } catch {
        return errorResponse("Invalid selections payload", 400);
      }
      if (!Array.isArray(selections.categories)) return errorResponse("selections.categories required", 400);
      if (!Array.isArray(selections.skippedMcpServers)) selections.skippedMcpServers = [];

      const parsed = parseBackupZip(buffer);
      let report: RestoreReport;
      let npmPackages: string[];
      try {
        const result = restoreBackup(parsed, selections);
        report = result.report;
        npmPackages = result.npmPackages;
      } finally {
        cleanupParsedBackup(parsed);
      }
      backupBuffers.delete(token);

      // Async npm package reinstall is opt-in (npm postinstall scripts run
      // arbitrary code from the backup). Preview lists the specs; the user
      // must explicitly choose to reinstall them.
      if (selections.reinstallNpm === true && npmPackages.length > 0) {
        const agentDir = getAgentDir();
        const cwd = homedir();
        const settingsManager = SettingsManager.create(cwd, agentDir, {
          projectTrusted: getProjectTrustStatus(cwd, agentDir).trusted,
        });
        const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
        void (async () => {
          for (const spec of npmPackages) {
            try {
              await packageManager.installAndPersist(spec, { local: false });
            } catch (error) {
              report.warnings.push(
                `npm package ${spec} reinstall failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        })();
        report.warnings.push(
          `npm packages reinstalling in background: ${npmPackages.join(", ")} — restart to load them.`,
        );
      }

      return NextResponse.json({ phase: "report", report });
    }

    return errorResponse(`Unsupported phase: ${phase}`, 400);
  } catch (error) {
    return errorResponse(error, 400);
  }
}
