import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "bliss_session";
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/bookings", "/payouts", "/settings"];
const PUBLIC_AUTH_ROUTES = ["/login", "/signup"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // Bounce signed-in users away from the sign-in entry points.
  if (hasSession && PUBLIC_AUTH_ROUTES.some((p) => pathname === p)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Gate the merchant app routes.
  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/signup",
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/bookings/:path*",
    "/payouts/:path*",
    "/settings/:path*",
  ],
};
