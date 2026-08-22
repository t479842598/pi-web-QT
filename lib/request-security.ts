import { isIP } from "node:net";

function normalizeHostname(value: string): string {
  const unbracketed = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

function hostnameFromAuthority(value: string): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

function normalizeConfiguredHostname(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return isIP(trimmed) ? normalizeHostname(trimmed) : hostnameFromAuthority(trimmed);
}

function configuredHostnamesFromEnvironment(): string[] {
  return [
    process.env.PI_WEB_HOSTNAME,
    ...(process.env.PI_WEB_ALLOWED_HOSTS?.split(",") ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getRequestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  return host ? canonicalOrigin(`${requestUrl.protocol}//${host}`) : null;
}

function isUserInitiatedSessionExportNavigation(request: Request): boolean {
  if (
    request.method !== "GET"
    || request.headers.get("sec-fetch-mode") !== "navigate"
    || request.headers.get("sec-fetch-dest") !== "document"
    || request.headers.get("sec-fetch-user") !== "?1"
  ) return false;

  try {
    return /^\/api\/sessions\/[^/]+\/export$/.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

/** Accept local names, IP literals, and hostnames explicitly selected by the operator. */
export function isApiRequestHostAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  const host = request.headers.get("host");
  const hostname = host ? hostnameFromAuthority(host) : null;
  if (!hostname) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname)) return true;
  return configuredHostnames.some((configured) => normalizeConfiguredHostname(configured) === hostname);
}

/**
 * Compare an Origin header against the request's own origin, tolerating the
 * one legitimate case where they differ: Chromium 150+ strips the port from
 * the Origin header for same-origin requests on non-default ports. Scheme and
 * hostname must always match; an explicit Origin port must match exactly. An
 * Origin WITHOUT a port is accepted on the hostname match alone, which keeps
 * legitimate Chromium requests working while still rejecting a same-host
 * service on a different port (its Origin carries that port).
 */
function originMatchesRequest(origin: string, requestOrigin: string): boolean {
  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(requestOrigin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== requestUrl.protocol) return false;
  if (originUrl.hostname.toLowerCase() !== requestUrl.hostname.toLowerCase()) return false;
  if (!originUrl.port) return true; // port stripped by Chromium → tolerate
  const requestPort = requestUrl.port || (requestUrl.protocol === "https:" ? "443" : "80");
  return originUrl.port === requestPort;
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isApiRequestOriginAllowed(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const requestOrigin = getRequestOrigin(request);
  if (!requestOrigin) return false;
  return originMatchesRequest(origin, requestOrigin);
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}

/** Mutating methods must come from a same-origin browser page. Plain HTTP
 *  clients (curl, scripts) that send no Origin header can read but never
 *  write — this keeps LAN-visible instances (0.0.0.0 listen) from being
 *  reconfigured by any device on the network. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isApiRequestAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  if (!isApiRequestHostAllowed(request, configuredHostnames)) return false;
  if (isUserInitiatedSessionExportNavigation(request)) return true;
  if (!shouldCheckApiRequestOrigin(request)) {
    // Non-browser client: reads are fine, writes require a same-origin page.
    return !WRITE_METHODS.has((request.method ?? "GET").toUpperCase());
  }
  return isApiRequestOriginAllowed(request);
}

export function hasJsonContentType(request: Request): boolean {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}
