import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestAllowed, isApiRequestHostAllowed } from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isValidWebSessionToken,
  isWebPasswordEnabled,
  PI_WEB_SESSION_COOKIE,
} from "@/lib/web-auth";

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

  // Development convenience: skip auth during `next dev` for loopback clients
  // only — `dev:lan` (0.0.0.0) must not silently drop the auth gate for every
  // device on the network. Production builds always keep the gate.
  const isDev = process.env.NODE_ENV === "development";
  const host = request.headers.get("host") ?? "";
  const isLoopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const skipAuth = isDev && isLoopbackHost;

  // Basic stays valid on EVERY route (page and API), not just /api/*: the Tauri
  // desktop shell injects it into page navigations through its local proxy
  // (desktop/src/proxy.rs), and the Flutter client + memory watchdog send it to
  // APIs. Restricting it to /api/* would break those clients' page loads.
  const authenticated = skipAuth
    || isValidBasicAuthorization(request.headers.get("authorization"), password)
    || isValidWebSessionToken(request.cookies.get(PI_WEB_SESSION_COOKIE)?.value, password);

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
  return NextResponse.redirect(loginUrl, 307);
}

// Match every path: any future page route must not silently bypass the
// host allowlist and the auth gate. Static assets are allowlisted above so the
// login redirect cannot white-screen the app.
export const config = { matcher: ["/:path*"] };
