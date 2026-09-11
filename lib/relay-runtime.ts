import { createRelayClientFromEnv, deviceMidFor, type RelayClient } from "./relay-client";
import { attachHttpBridge, type HttpBridge } from "./relay-http-bridge";
import { PI_WEB_AUTH_USERNAME, isWebPasswordEnabled } from "./web-auth";

/**
 * Process-wide relay client holder.
 *
 * Anchored on `globalThis` because Next.js hot-reload re-evaluates modules: a
 * module-level singleton would open a second socket on every edit and leave the
 * relay with several stale registrations for the same device.
 */

declare global {
  var __piRelayClient: RelayClient | null | undefined;
  var __piRelayBridge: HttpBridge | null | undefined;
}

/** Stable mid for this machine so a reconnect replaces, rather than duplicates. */
function deviceMid(): string {
  const configured = process.env.PI_WEB_DEVICE_ID?.trim();
  if (configured) return deviceMidFor(configured);
  return deviceMidFor(`${process.platform}-${process.env.HOSTNAME ?? "pi-web"}-${process.cwd()}`);
}

/**
 * Loopback address of this same server.
 *
 * The hostname is loopback-only by construction (the launcher binds 127.0.0.1),
 * and the tunnelled path is appended as-is, so the bridge can never be pointed
 * at another host by a client.
 */
function localBaseUrl(): string {
  const host = process.env.PI_WEB_HOSTNAME?.trim() || "127.0.0.1";
  const port = process.env.PI_WEB_PORT?.trim() || "30141";
  return `http://${host}:${port}`;
}

/** Basic credentials for the local gate, kept server-side and never sent to the phone. */
function localAuthorization(): string | undefined {
  const password = process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(password)) return undefined;
  return `Basic ${Buffer.from(`${PI_WEB_AUTH_USERNAME}:${password}`, "utf8").toString("base64")}`;
}

/** Start the relay client (and its HTTP bridge) once per process. */
export function ensureRelayClient(): RelayClient | null {
  if (globalThis.__piRelayClient !== undefined) return globalThis.__piRelayClient;
  const client = createRelayClientFromEnv({
    deviceMid: deviceMid(),
    log: (message, extra) => {
      if (extra === undefined) console.log(message);
      else console.log(message, extra);
    },
  });
  globalThis.__piRelayClient = client;

  if (client) {
    globalThis.__piRelayBridge = attachHttpBridge(client, {
      baseUrl: localBaseUrl(),
      authorization: localAuthorization(),
      log: (message, extra) => {
        if (extra === undefined) console.log(`[relay-bridge] ${message}`);
        else console.log(`[relay-bridge] ${message}`, extra);
      },
    });
    client.start();
  }
  return client;
}

export function getRelayClient(): RelayClient | null {
  return globalThis.__piRelayClient ?? null;
}

export function getRelayBridge(): HttpBridge | null {
  return globalThis.__piRelayBridge ?? null;
}
