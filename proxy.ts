import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

/**
 * Route protection for /dashboard and /api.
 *
 * This is deliberately an *optimistic* check: it only looks for the presence
 * of a session cookie and never touches the database, because it runs on
 * every matched request. It is not authorization — each route handler still
 * calls `auth()` and checks roles itself. A forged cookie gets past this and
 * is then rejected by the handler.
 *
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`; the exported function has
 * to be named `proxy` (or be the default export).
 */

/**
 * Exempt from the *session* check: sign-in itself, and the kiosks.
 *
 * `/api/hardware` is not public — every route there authenticates the device
 * from its headers. It is exempt here because a kiosk is an appliance with no
 * user session, so the cookie check would reject it before it could present
 * its own credentials.
 */
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/hardware/"];

/** Exempt only for the listed method. */
const PUBLIC_API_ROUTES = [
  { method: "GET", pattern: /^\/api\/events\/?$/ },
  { method: "POST", pattern: /^\/api\/registrations\/?$/ },
];

function isPublicApiRequest(pathname: string, method: string): boolean {
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  return PUBLIC_API_ROUTES.some(
    (route) => route.method === method && route.pattern.test(pathname),
  );
}

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api");

  if (isApi && isPublicApiRequest(pathname, request.method)) {
    return NextResponse.next();
  }

  if (hasSessionCookie(request)) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const signInUrl = new URL("/api/auth/signin", request.url);
  signInUrl.searchParams.set("callbackUrl", pathname);

  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
