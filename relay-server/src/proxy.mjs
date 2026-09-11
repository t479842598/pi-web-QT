/**
 * `/web/*` reverse proxy to the desktop's pi-web.
 *
 * This is how a phone gets the *full* pi-web interface — sessions, models, auth,
 * files — without the relay reimplementing any of it. The desktop serves
 * absolute paths (`/_next/...`, `/api/...`), so those have to be routed back
 * through the same prefix; otherwise the proxied page loads HTML and then every
 * asset 404s.
 *
 * Chat data keeps flowing over the WebSocket tunnel; this path exists for
 * everything else.
 */

/** Prefix the full app is mounted under. */
export const WEB_PREFIX = "/web";

/** Absolute paths the proxied app emits that must be re-prefixed. */
const APP_ABSOLUTE_PREFIXES = [
  "/_next/",
  "/api/",
  "/icon",
  "/favicon",
  "/manifest",
  "/pi-original",
  "/provider-icons",
];

/**
 * Paths that must NOT be rewritten even though they start with the prefix.
 * The proxy's own entry point is served by the relay, not upstream.
 */
export function isRelayOwnedPath(pathname) {
  return pathname === WEB_PREFIX || pathname === `${WEB_PREFIX}/`;
}

/** True when an app-emitted absolute path belongs to the proxied application. */
export function isAppAbsolutePath(pathname) {
  if (isRelayOwnedPath(pathname)) return false;
  return APP_ABSOLUTE_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix));
}

/**
 * Map an incoming request path to the upstream path.
 *
 * `/web/api/sessions` → `/api/sessions`; `/api/sessions` (an absolute asset
 * path the app itself emitted) is passed through unchanged.
 */
export function toUpstreamPath(pathname) {
  if (pathname === WEB_PREFIX) return "/";
  if (pathname.startsWith(`${WEB_PREFIX}/`)) return pathname.slice(WEB_PREFIX.length);
  return pathname;
}

/**
 * Rewrite an absolute path emitted by the app so the browser requests it
 * through the proxy.
 */
export function toProxiedPath(pathname) {
  if (!isAppAbsolutePath(pathname)) return pathname;
  return `${WEB_PREFIX}${pathname}`;
}

/**
 * Rewrite `Location` headers on redirects.
 *
 * Any app-relative redirect (`/login`, `/sessions`) has to be prefixed, not
 * just the asset prefixes — otherwise a 30x escapes to the relay origin and
 * lands on its 404.
 */
export function rewriteLocation(location) {
  if (typeof location !== "string") return location;
  if (!location.startsWith("/")) return location;
  if (location.startsWith(`${WEB_PREFIX}/`) || location === WEB_PREFIX) return location;
  return `${WEB_PREFIX}${location}`;
}

/**
 * Rewrite absolute paths inside HTML.
 *
 * Next.js emits absolute URLs in the document body (script preloads, inline
 * bootstrap data). Those are not `Location` headers, so they need a textual
 * pass or they resolve against the relay origin and 404.
 *
 * The prefix list covers asset roots; a general pass handles the remaining
 * app-relative links the document may inline.
 */
export function rewriteHtml(html) {
  if (typeof html !== "string" || html.length === 0) return html;
  let out = html;
  for (const prefix of APP_ABSOLUTE_PREFIXES) {
    // Only rewrite when not already prefixed, so a second pass is a no-op.
    out = out.split(`"${prefix}`).join(`"${WEB_PREFIX}${prefix}`);
    out = out.split(`'${prefix}`).join(`'${WEB_PREFIX}${prefix}`);
    out = out.split(`=${prefix}`).join(`=${WEB_PREFIX}`);
  }
  // Any other root-relative href/src (e.g. `/sessions`, `/login`) belongs to the
  // app too; leaving it absolute would send the browser to the relay's 404.
  out = out.replace(/(href|src)="\/(?!\/|web\/)/g, `$1="${WEB_PREFIX}/`);
  out = out.replace(/(href|src)='\/(?!\/|web\/)/g, `$1='${WEB_PREFIX}/`);
  return out;
}

/** True when a response body should get the HTML rewrite pass. */
export function isHtmlResponse(headers) {
  const type = headers?.["content-type"] ?? headers?.["Content-Type"] ?? "";
  return typeof type === "string" && type.includes("text/html");
}
