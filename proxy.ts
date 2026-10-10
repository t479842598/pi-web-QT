import { NextResponse, type NextRequest } from "next/server";
import { getAuthRetryAfterMs, recordAuthFailure } from "@/lib/auth-throttle";
import { isApiRequestAllowed, isApiRequestHostAllowed } from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isValidWebSessionToken,
  isWebPasswordEnabled,
  PI_WEB_SESSION_COOKIE,
} from "@/lib/web-auth";

function tooManyAttempts(retryAfterMs: number): NextResponse {
  return new NextResponse("Too many failed attempts", {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
    },
  });
}

/**
 * Static asset prefixes that must never be redirected to the login page.
 *
 * This fork's matcher covers EVERY path (see `config.matcher`), unlike upstream
 * which only runs the proxy on `/`, `/login` and `/api/*`. Without this
 * allowlist an unauthenticated page load would 307 `/_next/*.js` and `/favicon`
 * as well, so `/login` could not load its own bundle and the app would go
 * blank instead of showing the login form.
 */
const STATIC_ASSET_PREFIXES = ["/_next/", "/icons/", "/catppuccin-icons/"];
const STATIC_ASSET_PATHS = new Set([
  "/favicon.svg",
  "/favicon.ico",
  "/icon.png",
  "/icon.svg",
  "/icon.ico",
  "/pi-original.svg",
  "/provider-icons.svg",
  "/gruvbox-dark.json",
]);

function isStaticAsset(pathname: string): boolean {
  return STATIC_ASSET_PATHS.has(pathname)
    || STATIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Passwordless mode is a deliberate local-only posture. A request arriving
// under any other hostname (LAN IP, tunnel domain) means the deployment serves
// sessions, files and the file browser unauthenticated to that origin; warn
// loudly once per host instead of hard-blocking, which would break legitimate
// LAN usage. globalThis Set survives hot reload like the auth-throttle state.
const passwordlessWarnedHosts = (globalThis as { __piPasswordlessWarnedHosts?: Set<string> }).__piPasswordlessWarnedHosts ??= new Set<string>();

function warnPasswordlessExposure(hostname: string): void {
  const host = hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1"
    || host === "[::1]" || host.endsWith(".localhost");
  if (isLoopback || passwordlessWarnedHosts.has(host) || passwordlessWarnedHosts.size >= 16) return;
  passwordlessWarnedHosts.add(host);
  console.warn(
    `[pi-web] SECURITY WARNING: no PI_WEB_PASSWORD is configured, but requests are arriving for `
    + `non-loopback host "${host}". Sessions, files and the file browser are readable from this `
    + `origin without authentication. Set PI_WEB_PASSWORD, or restrict access to localhost.`,
  );
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Dev-only convenience: freshly compiled chunks must not be cached by the
  // browser. Scoped to development — in production static assets go through the
  // same trust checks as everything else.
  const isDevelopmentChunk = process.env.NODE_ENV === "development"
    && pathname.startsWith("/_next/static/");
  if (isDevelopmentChunk) {
    return NextResponse.next({
      headers: { "Cache-Control": "no-store" },
    });
  }

  const isApiRequest = pathname === "/api" || pathname.startsWith("/api/");
  const trusted = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!trusted) {
    return isApiRequest
      ? NextResponse.json({ error: "Untrusted API request" }, { status: 403 })
      : new NextResponse("Untrusted request", { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  const passwordEnabled = isWebPasswordEnabled(password);

  // No password configured: the login route has nothing to do — send it home.
  if (!passwordEnabled) {
    warnPasswordlessExposure(request.nextUrl.hostname);
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url), 302);
    }
    return NextResponse.next();
  }

  // Static assets and the login API are always reachable, or the login page
  // cannot render itself and the user is locked out.
  if (isStaticAsset(pathname) || pathname === "/api/web-auth") {
    return NextResponse.next();
  }

  // Host is supplied by the client, not proof of a loopback connection.
  // A configured password must be enforced in development and production alike.

  // Session cookie first: a valid cookie is never blocked by the throttle.
  if (isValidWebSessionToken(request.cookies.get(PI_WEB_SESSION_COOKIE)?.value, password)) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url), 302);
    }
    return NextResponse.next();
  }

  // Every Basic verifier shares the throttle, including page navigations:
  // redirect differences otherwise turn pages into an unlimited password oracle.
  // Basic success never resets the counter, since clients send it on every request.
  // Keep Basic valid on pages for the desktop proxy; valid cookies already bypass
  // this branch, and static assets/headerless login stay accessible above/below.
  const authorization = request.headers.get("authorization");
  let authenticated: boolean;
  if (authorization && /^Basic\s/i.test(authorization)) {
    const retryAfterMs = getAuthRetryAfterMs();
    if (retryAfterMs > 0) return tooManyAttempts(retryAfterMs);
    authenticated = isValidBasicAuthorization(authorization, password);
    if (!authenticated) recordAuthFailure();
  } else {
    authenticated = false;
  }

  if (authenticated) {
    // Already signed in: keep the login page out of the way.
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url), 302);
    }
    return NextResponse.next();
  }

  if (pathname === "/login") return NextResponse.next();

  // API clients (scripts, mobile, watchdog) get the 401 challenge; browsers get
  // a real login page instead of a native credential dialog.
  if (isApiRequest) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  // Tell the login page WHY it is showing: a session cookie that failed
  // validation (expired / password rotated) vs no cookie at all (Safari
  // cleared site data, private mode, or cookie blocking). This is what makes
  // the recurring "Safari forgot my login" reports diagnosable in the field.
  loginUrl.searchParams.set(
    "reason",
    request.cookies.get(PI_WEB_SESSION_COOKIE)?.value ? "invalid" : "missing",
  );
  return NextResponse.redirect(loginUrl, 307);
}

// Match every path: any future page route must not silently bypass the
// host allowlist and the auth gate. Static assets are allowlisted above so the
// login redirect cannot white-screen the app.
export const config = { matcher: ["/:path*"] };
