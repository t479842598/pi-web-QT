import { EventEmitter } from "node:events";
import * as undici from "undici";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcherConfigured?: boolean;
};

const dispatcherGlobal = globalThis as DispatcherGlobal;
const ignoreUndiciDispatcherError = (): void => {};

/** The dispatcher currently installed as the global one (for graceful close on reconfigure). */
let currentDispatcher: undici.Dispatcher | null = null;

function installGlobalDispatcher(dispatcher: undici.Dispatcher): void {
  undici.setGlobalDispatcher(dispatcher);
  // Gracefully close the previous dispatcher after swapping so in-flight
  // requests finish first; repeated proxy saves otherwise leak an entire
  // EnvHttpProxyAgent connection pool per save.
  const previous = currentDispatcher;
  currentDispatcher = dispatcher;
  if (previous) {
    previous.close().catch(() => {});
  }
}

export function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "disabled") return 0;
    if (trimmed.length === 0) return undefined;
    return parseHttpIdleTimeoutMs(Number(trimmed));
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(new undici.Client(origin, options as undici.Client.Options));
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) return createUndiciClient(origin, dispatcherOptions);
  return withUndiciErrorListener(new undici.Pool(origin, {
    ...dispatcherOptions,
    factory: createUndiciClient,
  }));
}

/**
 * Apply a process-wide Undici dispatcher once for Node route handlers.
 * EnvHttpProxyAgent deliberately honors the operator's HTTP(S)_PROXY and
 * NO_PROXY configuration; Electron remains loopback-only at its listener.
 */
export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): void {
  if (dispatcherGlobal.__piWebHttpDispatcherConfigured) return;
  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }

  const dispatcher = withUndiciErrorListener(new undici.EnvHttpProxyAgent({
    allowH2: false,
    bodyTimeout: normalizedTimeoutMs,
    headersTimeout: normalizedTimeoutMs,
    clientFactory: createUndiciClient,
    factory: createUndiciOriginDispatcher,
  }));
  installGlobalDispatcher(dispatcher);

  // Do NOT call undici.install() here. Node's native global fetch is already
  // an undici implementation that reads the global dispatcher on every call,
  // so setGlobalDispatcher() alone is enough for HTTP(S)_PROXY to take effect.
  // install() swaps globalThis.Response/Request/Headers/fetch/WebSocket for
  // undici's own classes; Next.js classes like NextResponse capture the
  // *previous* Response at module-load time, so after a runtime install()
  // every route handler fails its `instanceof Response` check with
  // "Expected an instance of Response to be returned" (500, empty body) —
  // this is the proxy-save crash: the whole API dies until the server restarts.
  dispatcherGlobal.__piWebHttpDispatcherConfigured = true;
}

/**
 * Reconfigure the global Undici dispatcher at runtime.
 * Useful when proxy settings have changed after the initial configuration.
 * Calls configureHttpDispatcher after resetting the configured flag.
 */
export function reconfigureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): void {
  dispatcherGlobal.__piWebHttpDispatcherConfigured = false;
  configureHttpDispatcher(timeoutMs);
}
