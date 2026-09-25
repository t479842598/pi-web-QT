import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { invalidateModelsCache } from "./models-cache";
import { invalidateAvailableModelsCache } from "./model-scope";

export type ModelsConfigData = Record<string, unknown>;

interface MutatedModelsConfig<T> {
  data: ModelsConfigData;
  result: T;
  changed?: boolean;
}

const LOCK_OPTIONS = {
  retries: { retries: 10, factor: 2, minTimeout: 50, maxTimeout: 2_000, randomize: true },
  stale: 30_000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getModelsConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "models.json");
}

function ensureModelsFile(path: string): void {
  const directory = dirname(path);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(path)) return;

  try {
    writeFileSync(path, JSON.stringify({ providers: {} }, null, 2), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    // Another writer may have created the file between existsSync and writeFileSync.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/** models.json exists but its contents cannot be used, so it must not be replaced. */
export class ModelsConfigReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelsConfigReadError";
  }
}

/**
 * Mirrors pi's `stripJsonComments` (utils/json.js, not exported by the SDK):
 * drops `//` line comments and trailing commas, leaving string literals alone.
 */
function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) => (match[0] === '"' ? match : ""))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail?: string) => tail ?? (match[0] === '"' ? match : ""));
}

/**
 * Read and validate the shape used by the models settings UI. Reads with the
 * same leniency as pi's loader (BOM, `//` comments, trailing commas): a file
 * pi accepts must never read as empty here — the panel saves its whole draft,
 * so an empty read would delete every provider on the next save. Unusable
 * contents throw (ModelsConfigReadError) instead of being silently replaced.
 */
export function readModelsConfig(path = getModelsConfigPath()): ModelsConfigData {
  if (!existsSync(path)) return { providers: {} };
  let parsed: unknown;
  try {
    const content = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    if (!content.trim()) return { providers: {} };
    parsed = JSON.parse(stripJsonComments(content));
  } catch (error) {
    throw new ModelsConfigReadError(
      `Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) throw new ModelsConfigReadError("Invalid models.json: expected an object");
  if (parsed.providers !== undefined && !isRecord(parsed.providers)) {
    throw new ModelsConfigReadError("Invalid models.json: providers must be an object");
  }
  return parsed;
}

/**
 * Read-modify-write models.json under one process/cross-process lock.
 * The mutator receives the newest on-disk snapshot, never a client snapshot.
 */
export async function mutateModelsConfig<T>(
  mutator: (current: ModelsConfigData) => MutatedModelsConfig<T> | Promise<MutatedModelsConfig<T>>,
  path = getModelsConfigPath(),
): Promise<T> {
  ensureModelsFile(path);
  let compromisedError: Error | undefined;
  const release = await lockfile.lock(path, {
    ...LOCK_OPTIONS,
    onCompromised: (error) => { compromisedError = error; },
  });

  const throwIfCompromised = () => {
    if (compromisedError) throw compromisedError;
  };

  try {
    throwIfCompromised();
    const current = readModelsConfig(path);
    const mutation = await mutator(current);
    if (!isRecord(mutation.data)) throw new Error("Invalid models.json mutation result");
    throwIfCompromised();
    if (mutation.changed !== false) {
      writePrivateFileAtomicSync(path, JSON.stringify(mutation.data, null, 2));
      invalidateModelsCache();
      // The in-process ModelRuntime list is cached too (see model-scope.ts);
      // both caches must drop together or startRpcSession keeps serving the
      // stale provider/model list until the 60s TTL expires.
      invalidateAvailableModelsCache();
      throwIfCompromised();
    }
    return mutation.result;
  } finally {
    try {
      await release();
    } catch (error) {
      if (compromisedError) throw compromisedError;
      throw error;
    }
  }
}

export function readModelsConfigOrEmpty(path = getModelsConfigPath()): ModelsConfigData {
  try {
    return readModelsConfig(path);
  } catch {
    return { providers: {} };
  }
}

export function assertModelsConfigBody(value: unknown): asserts value is ModelsConfigData {
  if (!isRecord(value)) throw new Error("models.json payload must be an object");
  if (value.providers !== undefined && !isRecord(value.providers)) {
    throw new Error("models.json payload providers must be an object");
  }
}

/** Replace the document while still serializing with all other model writes. */
export function replaceModelsConfig(
  data: ModelsConfigData,
  path = getModelsConfigPath(),
): Promise<void> {
  assertModelsConfigBody(data);
  return mutateModelsConfig(async () => ({ data, result: undefined }), path);
}
