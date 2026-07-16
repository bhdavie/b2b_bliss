import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "bliss_session";
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/bookings", "/payouts", "/settings"];
const PUBLIC_AUTH_ROUTES = ["/login", "/signup"];

// Production serves one Next deployment on two hostnames. Each route belongs to
// exactly one of them, and a request landing on the wrong host is redirected
// rather than served, so every route has a single canonical origin.
const MERCHANT_HOST = "property.bliss-payments.com";
const GUEST_HOST = "guest.bliss-payments.com";

// Merchant dashboard (property). /verify is the magic-link landing and
// /check-email its companion, so both are merchant-side.
const MERCHANT_PREFIXES = [
  "/dashboard",
  "/bookings",
  "/payouts",
  "/plans",
  "/settings",
  "/home",
  "/login",
  "/signup",
  "/onboarding",
  "/verify",
  "/check-email",
  "/mews-marketplace",
];

// Consumer portal and checkout (guest). Note /plan (singular, consumer) against
// /plans (plural, merchant) — matching is segment-aware so they cannot collide.
const GUEST_PREFIXES = ["/account", "/plan", "/pay", "/inn", "/checkout"];

/**
 * Segment-aware prefix match: "/plan" matches "/plan" and "/plan/abc" but never
 * "/plans". A bare startsWith would send the merchant plan list to the guest
 * host.
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

function isMerchantRoute(pathname: string): boolean {
  return MERCHANT_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

function isGuestRoute(pathname: string): boolean {
  return GUEST_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

function redirectToHost(request: NextRequest, host: string) {
  const url = new URL(request.url);
  url.protocol = "https:";
  url.host = host;
  url.port = "";
  // 307 preserves method and body. These are mostly GETs, but a form POST to
  // the wrong host should not silently degrade into a GET.
  return NextResponse.redirect(url, 307);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Host header rather than nextUrl.hostname: behind Vercel's proxy the latter
  // does not reliably carry the hostname the client actually requested.
  const host = (request.headers.get("host") ?? "").split(":")[0]?.toLowerCase() ?? "";

  // Only the two production hostnames split. Anything else — localhost,
  // *.vercel.app previews — serves every route from one origin, as today.
  if (host === MERCHANT_HOST && isGuestRoute(pathname)) {
    return redirectToHost(request, GUEST_HOST);
  }
  if (host === GUEST_HOST && isMerchantRoute(pathname)) {
    return redirectToHost(request, MERCHANT_HOST);
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // Bounce signed-in users away from the sign-in entry points.
  if (hasSession && PUBLIC_AUTH_ROUTES.some((p) => pathname === p)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Gate the merchant app routes.
  if (PROTECTED_PREFIXES.some((p) => matchesPrefix(pathname, p))) {
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Broadened from the merchant-only list: host routing has to cover consumer
  // routes too. Excludes static assets, the image optimizer, and /api/health,
  // which must answer on both hosts.
  matcher: ["/((?!_next/static|_next/image|api/health|favicon.ico|.*\\.[^/]+$).*)"],
};
