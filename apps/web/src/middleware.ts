/**
 * Every page and API route needs a login, except the login itself, /health,
 * and the agent API (which checks its own bearer token).
 *
 * POST /login is rewritten to the route handler; GET /login is the page.
 * (A page and a route handler cannot share one path in the App Router.)
 */
import { unsealData } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, type SessionData } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/health", "/api/auth/login"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * TRACKER_READ_ONLY=1 (the parallel week): the nightly Mongo -> Postgres
 * sync replaces every table, so a change made here would be lost the next
 * morning. Every write is refused; the old Tracker stays the place to edit.
 */
function readOnlyRefusal(req: NextRequest): NextResponse | null {
  if (process.env.TRACKER_READ_ONLY !== "1") return null;
  const { pathname } = req.nextUrl;
  if (SAFE_METHODS.has(req.method) || !pathname.startsWith("/api/") || pathname === "/api/auth/login") return null;
  return NextResponse.json(
    { ok: false, error: "Read-only during the parallel week: make this change in the current Tracker" },
    { status: 423 },
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/login" && req.method === "POST") {
    return NextResponse.rewrite(new URL("/api/auth/login", req.url));
  }
  const refused = readOnlyRefusal(req);
  if (refused) return refused;
  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/api/agent/")) {
    return NextResponse.next();
  }

  const sealed = req.cookies.get(SESSION_COOKIE)?.value;
  if (sealed) {
    try {
      const session = await unsealData<SessionData>(sealed, { password: process.env.SESSION_SECRET ?? "" });
      if (session.user) return NextResponse.next();
    } catch {
      // tampered or expired cookie: treated as logged out
    }
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  // Middleware needs an absolute Location. Build it from the Host header the
  // browser sent: req.url can name another host (next dev says "localhost"
  // for 127.0.0.1), and the session cookie would not follow the redirect.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const login = new URL("/login", `${req.nextUrl.protocol}//${host}`);
  if (pathname !== "/") login.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next.js internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|svg|png|ico)$).*)"],
};
