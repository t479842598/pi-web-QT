/**
 * Outbound relay client.
 *
 * Unlike the tunnel path (which accepts inbound HTTPS), this connects *out* to
 * a relay the owner runs, so pi-web works from behind any NAT without exposing
 * a port. The relay is a transparent pipe; this module only keeps the socket
 * alive, registers the device, and forwards frames surfaced by the caller.
 *
 * Disabled unless `PI_WEB_RELAY_URL` is set — an unconfigured install must not
 * open an unexpected outbound socket.
 */

import { createHash, randomBytes } from "node:crypto";

export const RELAY_PROTOCOL_VERSION = 1;
export const DEVICE_REGISTER_INIT = "device_register_init";
export const DEVICE_REGISTER_ACK = "device_register_ack";
export const PAIR_REGISTER = "pair_register";
export const PAIR_RESULT = "pair_result";
export const PING = "ping";
export const PONG = "pong";

/** Reconnect backoff: quick first retries, then settle at 30s. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const PING_INTERVAL_MS = 25_000;

export interface RelayClientOptions {
  url: string;
  deviceMid: string;
  deviceName: string;
  appVersion: string;
  /** Shared secret the relay requires to accept a device registration. */
  deviceSecret?: string;
  /** Injected for tests; defaults to the global WebSocket. */
  socketFactory?: (url: string) => RelaySocket;
  log?: (message: string, extra?: unknown) => void;
}

/** The slice of the WebSocket API this module uses. */
export interface RelaySocket {
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type RelayState = "idle" | "connecting" | "registered" | "closed";

export function deviceMidFor(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);
}

/** Random per-process device id; stable enough for a single server lifetime. */
export function createDeviceMid(): string {
  return randomBytes(16).toString("hex");
}

export class RelayClient {
  private socket: RelaySocket | null = null;
  private state: RelayState = "idle";
  private attempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private lastError: string | null = null;
  private nextRequestId = 1;
  private pending = new Map<string, (frame: Record<string, unknown>) => void>();

  constructor(private readonly options: RelayClientOptions) {}

  /** This client's device id, as seen by the relay. */
  get deviceMid(): string {
    return this.options.deviceMid;
  }

  getState(): { state: RelayState; attempt: number; url: string; lastError: string | null } {
    return { state: this.state, attempt: this.attempt, url: this.options.url, lastError: this.lastError };
  }

  start(): void {
    if (this.stopped) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    try { this.socket?.close(); } catch { /* already gone */ }
    this.socket = null;
    this.state = "closed";
  }

  /** Send a frame to the relay (routed to paired mobile clients). */
  send(message: unknown): boolean {
    if (!this.socket || this.state !== "registered") return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.options.log?.("relay send failed", error);
      return false;
    }
  }

  /**
   * Send a control frame and resolve with the relay's correlated reply.
   *
   * `rid` is the relay's own id space; it echoes the value back on
   * `pair_result`, which is what lets two in-flight requests coexist.
   */
  request(message: Record<string, unknown>, timeoutMs = 5_000): Promise<Record<string, unknown>> {
    if (!this.socket || this.state !== "registered") {
      return Promise.resolve({ type: PAIR_RESULT, ok: false, code: "relayUnavailable" });
    }
    const rid = String(this.nextRequestId++);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        resolve({ type: PAIR_RESULT, ok: false, code: "relayUnavailable" });
      }, timeoutMs);
      this.pending.set(rid, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
      try {
        this.socket?.send(JSON.stringify({ ...message, rid }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(rid);
        resolve({ type: PAIR_RESULT, ok: false, code: "relayUnavailable" });
      }
    });
  }

  private log(message: string, extra?: unknown): void {
    this.options.log?.(`[relay-client] ${message}`, extra);
  }

  private clearTimers(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private connect(): void {
    this.clearTimers();
    this.state = "connecting";
    const factory = this.options.socketFactory
      ?? ((url: string) => new WebSocket(url) as unknown as RelaySocket);
    const separator = this.options.url.includes("?") ? "&" : "?";
    const url = `${this.options.url}${separator}role=device&mid=${encodeURIComponent(this.options.deviceMid)}`;

    let socket: RelaySocket;
    try {
      socket = factory(url);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.log("connected", { url: this.options.url });
      socket.send(JSON.stringify({
        type: DEVICE_REGISTER_INIT,
        protocol_version: RELAY_PROTOCOL_VERSION,
        device_mid: this.options.deviceMid,
        device_secret: this.options.deviceSecret ?? "",
        meta: { name: this.options.deviceName, version: this.options.appVersion, platform: process.platform },
      }));
    };

    socket.onmessage = (event) => {
      const frame = parseFrame(event.data);
      if (!frame) return;
      // A correlated reply to one of our own requests.
      if (frame.rid !== undefined) {
        const settle = this.pending.get(String(frame.rid));
        if (settle) {
          this.pending.delete(String(frame.rid));
          settle(frame);
          return;
        }
      }
      if (frame.type === DEVICE_REGISTER_ACK) {
        this.state = "registered";
        this.attempt = 0;
        this.lastError = null;
        this.log("registered", { deviceMid: frame.device_mid });
        this.pingTimer = setInterval(() => this.send({ type: PING }), PING_INTERVAL_MS);
        this.pingTimer.unref?.();
        return;
      }
      if (frame.type === PONG) return;
      this.onFrame?.(frame);
    };

    socket.onerror = (event) => {
      this.lastError = event instanceof Error ? event.message : "socket error";
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.state = "closed";
      this.clearTimers();
      // Nothing will answer an in-flight request once the socket is gone.
      for (const settle of this.pending.values()) {
        settle({ type: PAIR_RESULT, ok: false, code: "relayUnavailable" });
      }
      this.pending.clear();
      this.log("disconnected", { attempt: this.attempt });
      this.scheduleReconnect();
    };
  }

  /** Called for every non-control frame the relay routes back. */
  onFrame: ((frame: Record<string, unknown>) => void) | null = null;

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }
}

function parseFrame(data: unknown): Record<string, unknown> | null {
  let text: string;
  if (typeof data === "string") text = data;
  else if (data instanceof Uint8Array) text = Buffer.from(data).toString("utf8");
  else return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Build a client from the environment, or return null when no relay is
 * configured. Callers are expected to treat null as "feature off".
 */
export function createRelayClientFromEnv(overrides: Partial<RelayClientOptions> = {}): RelayClient | null {
  const url = overrides.url ?? process.env.PI_WEB_RELAY_URL?.trim();
  if (!url) return null;
  return new RelayClient({
    url,
    deviceMid: overrides.deviceMid ?? createDeviceMid(),
    deviceName: overrides.deviceName ?? process.env.PI_WEB_RELAY_DEVICE_NAME?.trim() ?? "pi-web",
    appVersion: overrides.appVersion ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
    deviceSecret: overrides.deviceSecret ?? process.env.PI_WEB_RELAY_DEVICE_SECRET?.trim() ?? "",
    socketFactory: overrides.socketFactory,
    log: overrides.log,
  });
}
