import { createRelayClientFromEnv, deviceMidFor, type RelayClient } from "./relay-client";

/**
 * Process-wide relay client holder.
 *
 * Anchored on `globalThis` because Next.js hot-reload re-evaluates modules: a
 * module-level singleton would open a second socket on every edit and leave the
 * relay with several stale registrations for the same device.
 */

declare global {
  var __piRelayClient: RelayClient | null | undefined;
}

/** Stable mid for this machine so a reconnect replaces, rather than duplicates. */
function deviceMid(): string {
  const configured = process.env.PI_WEB_DEVICE_ID?.trim();
  if (configured) return deviceMidFor(configured);
  return deviceMidFor(`${process.platform}-${process.env.HOSTNAME ?? "pi-web"}-${process.cwd()}`);
}

/** Start the relay client once per process; a no-op when unconfigured. */
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
  client?.start();
  return client;
}

export function getRelayClient(): RelayClient | null {
  return globalThis.__piRelayClient ?? null;
}
