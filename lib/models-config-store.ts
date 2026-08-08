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

/** Read and validate the shape used by the models settings UI. */
export function readModelsConfig(path = getModelsConfigPath()): ModelsConfigData {
  if (!existsSync(path)) return { providers: {} };
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error("Invalid models.json: expected an object");
  if (parsed.providers !== undefined && !isRecord(parsed.providers)) {
    throw new Error("Invalid models.json: providers must be an object");
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
