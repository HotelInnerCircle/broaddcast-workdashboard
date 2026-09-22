import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName } from "@/lib/auth/cookies";

/**
 * Edge gate (spec 6.5): cheap cookie-presence check. Real session validation and
 * role checks happen server-side in the (dashboard) layouts and every route handler.
 */
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/invite"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(sessionCookieName())?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?callbackUrl=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|socket.io|manifest.webmanifest|sw.js|offline.html|icons|screenshots|.well-known|.*\..*).*)"],
};
