/**
 * Login session: an encrypted, httpOnly cookie (iron-session).
 *
 * Stateless on purpose: serverless functions share no memory, and a
 * single-user tracker does not need a sessions table. The cookie holds only
 * the username and when the login happened; it is sealed with SESSION_SECRET
 * (32+ characters), so it cannot be read or forged without that secret.
 */
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  user?: string;
  loggedInAt?: number;
}

export const SESSION_COOKIE = "tracker_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // like Flask-Login's remember cookie

export function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET ?? "";
  if (password.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return {
    cookieName: SESSION_COOKIE,
    password,
    ttl: MAX_AGE_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      // Plain-HTTP cookies only for local development and tests
      secure: process.env.NODE_ENV === "production" && process.env.TRACKER_INSECURE_COOKIES !== "1",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}
