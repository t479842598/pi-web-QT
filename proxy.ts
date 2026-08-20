import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestAllowed, isApiRequestHostAllowed } from "@/lib/request-security";
import { isValidBasicAuthorization, isWebPasswordEnabled } from "@/lib/web-auth";

export function proxy(request: NextRequest) {
  const isDevelopmentChunk = request.nextUrl.pathname.startsWith("/_next/static/");
  if (isDevelopmentChunk) {
    return NextResponse.next({
      headers: { "Cache-Control": "no-store" },
    });
  }

  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const trusted = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!trusted) {
    return isApiRequest
      ? NextResponse.json({ error: "Untrusted API request" }, { status: 403 })
      : new NextResponse("Untrusted request", { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  // Development convenience: skip basic auth during `next dev` for loopback
  // clients only — `dev:lan` (0.0.0.0) must not silently drop the auth gate
  // for every device on the network. Production builds always keep the gate.
  const isDev = process.env.NODE_ENV === "development";
  const host = request.headers.get("host") ?? "";
  const isLoopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const skipAuth = isDev && isLoopbackHost;
  if (!skipAuth && isWebPasswordEnabled(password) && !isValidBasicAuthorization(request.headers.get("authorization"), password)) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*", "/_next/static/:path*"] };
