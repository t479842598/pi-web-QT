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

  // Upstream v0.9.3: every Basic header on /api/* is a password guess, so it
  // shares the login form's throttle (otherwise any API path, or GET
  // /api/web-auth, answers guesses at full speed). While blocked even the
  // right password gets 429, or the answer would leak. A Basic success does
  // not reset the counter: Basic clients authenticate on every request, and
  // each reset would hand an interleaved guesser a fresh short block. The
  // throttle state lives on globalThis under a Symbol.for key, shared between
  // the proxy bundle and route handlers in both next dev and next start.
  // Basic itself stays valid on EVERY route, not just /api/*: the Tauri
  // desktop shell injects it into page navigations through its local proxy
  // (desktop/src/proxy.rs), and the Flutter client + memory watchdog send it
  // to APIs — restricting it to /api/* would break those clients' page loads.
  // Only API requests feed the throttle; page Basic auth is exempt.
  const authorization = request.headers.get("authorization");
  let authenticated: boolean;
  if (authorization && /^Basic\s/i.test(authorization)) {
    if (isApiRequest) {
      const retryAfterMs = getAuthRetryAfterMs();
      if (retryAfterMs > 0) return tooManyAttempts(retryAfterMs);
    }
    authenticated = isValidBasicAuthorization(authorization, password);
    if (!authenticated && isApiRequest) recordAuthFailure();
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
