/**
 * HTTP-over-WebSocket bridge.
 *
 * The hosted mobile page lives on the relay and cannot reach this server
 * directly, so its HTTP calls arrive as `http_request` frames on the relay
 * socket. This module performs them against the local server and streams the
 * answer back — including server-sent events, which must flow incrementally
 * rather than being buffered until completion.
 *
 * The target is always this same server over loopback. Requests never carry an
 * absolute URL, so a paired phone cannot make the bridge fetch an arbitrary
 * host.
 */

import { RelayClient } from "./relay-client";

export const HTTP_REQUEST = "http_request";
export const HTTP_RESPONSE_HEAD = "http_response_head";
export const HTTP_RESPONSE_CHUNK = "http_response_chunk";
export const HTTP_RESPONSE_END = "http_response_end";

/** Response chunk size; small enough to interleave, large enough to stay efficient. */
const CHUNK_BYTES = 64 * 1024;

export interface BridgeFrame {
  type: string;
  cid?: string;
  rid?: string | number;
  [key: string]: unknown;
}

/** Headers the client must not be allowed to forge when replaying locally. */
const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "accept-encoding", // Node's fetch handles compression itself
]);

export interface HttpBridgeOptions {
  /** Local base URL, e.g. http://127.0.0.1:30141. */
  baseUrl: string;
  /** Credentials replayed as Basic auth so the local gate is satisfied. */
  authorization?: string;
  log?: (message: string, extra?: unknown) => void;
  fetchImpl?: typeof fetch;
}

interface PendingStream {
  controller: AbortController;
}

/**
 * Bridge between relay tunnel frames and the local HTTP server.
 *
 * One instance per process; concurrent requests are tracked by `rid` so a
 * stream can be aborted when the page disconnects.
 */
export class HttpBridge {
  private readonly baseUrl: string;
  private readonly authorization?: string;
  private readonly log: (message: string, extra?: unknown) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly streams = new Map<string, PendingStream>();

  constructor(options: HttpBridgeOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.authorization = options.authorization;
    this.log = options.log ?? (() => {});
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Abort every in-flight stream (called when the relay socket drops). */
  abortAll(): void {
    for (const [, stream] of this.streams) stream.controller.abort();
    this.streams.clear();
  }

  /** Number of requests currently streaming, for diagnostics. */
  get inflightCount(): number {
    return this.streams.size;
  }

  /**
   * Execute one tunnelled request and stream the response back.
   *
   * Errors are reported as a synthetic 502 rather than thrown, so the page
   * always receives a response head and never hangs.
   */
  async handle(send: (frame: BridgeFrame) => void, frame: BridgeFrame): Promise<void> {
    const cid = typeof frame.cid === "string" ? frame.cid : "";
    const rid = frame.rid;
    if (!cid || rid === undefined) return;

    const key = `${cid}:${String(rid)}`;
    const controller = new AbortController();
    this.streams.set(key, { controller });

    const finish = () => {
      this.streams.delete(key);
      send({ type: HTTP_RESPONSE_END, cid, rid });
    };

    try {
      const path = typeof frame.path === "string" ? frame.path : "";
      if (!path.startsWith("/")) throw new Error(`invalid path: ${path}`);

      const method = typeof frame.method === "string" ? frame.method.toUpperCase() : "GET";
      const headers = new Headers();
      const rawHeaders = frame.headers;
      if (rawHeaders && typeof rawHeaders === "object") {
        for (const [name, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
          if (typeof value !== "string") continue;
          if (STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
          headers.set(name, value);
        }
      }
      // The relay connection is already authenticated by pairing; presenting
      // the server's own credentials keeps the local gate satisfied without
      // exposing them to the phone.
      if (this.authorization && !headers.has("authorization")) {
        headers.set("authorization", this.authorization);
      }

      const body = typeof frame.body === "string" && frame.body.length > 0 ? frame.body : undefined;
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        redirect: "manual",
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        // Content-encoding is already resolved by fetch; replaying it would
        // make the browser try to decode plain bytes.
        if (name.toLowerCase() === "content-encoding") return;
        responseHeaders[name] = value;
      });
      send({ type: HTTP_RESPONSE_HEAD, cid, rid, status: response.status, headers: responseHeaders });

      if (!response.body) {
        finish();
        return;
      }

      // Stream in chunks: SSE and long polls must not wait for completion.
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        for (let offset = 0; offset < value.byteLength; offset += CHUNK_BYTES) {
          const slice = value.subarray(offset, offset + CHUNK_BYTES);
          send({ type: HTTP_RESPONSE_CHUNK, cid, rid, data: Buffer.from(slice).toString("base64"), encoding: "base64" });
        }
      }
      finish();
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      if (!aborted) {
        const message = error instanceof Error ? error.message : String(error);
        this.log("bridge request failed", { path: frame.path, error: message });
        send({ type: HTTP_RESPONSE_HEAD, cid, rid, status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
        send({
          type: HTTP_RESPONSE_CHUNK,
          cid,
          rid,
          data: Buffer.from(`Bridge error: ${message}`, "utf8").toString("base64"),
          encoding: "base64",
        });
      }
      finish();
    }
  }
}

/**
 * Wire a bridge to a relay client, or return null when there is nothing to
 * bridge (no relay configured).
 */
export function attachHttpBridge(
  client: RelayClient | null,
  options: Omit<HttpBridgeOptions, "log"> & { log?: (message: string, extra?: unknown) => void },
): HttpBridge | null {
  if (!client) return null;
  const bridge = new HttpBridge(options);
  client.onFrame = (frame) => {
    if (frame.type !== HTTP_REQUEST) return;
    void bridge.handle((reply) => { client.send(reply); }, frame as BridgeFrame);
  };
  return bridge;
}
