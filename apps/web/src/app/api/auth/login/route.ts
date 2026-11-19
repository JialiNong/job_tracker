/**
 * POST /login (rewritten here by middleware): the login form, sent as
 * application/x-www-form-urlencoded like the Flask form.
 */
import type { NextRequest } from "next/server";
import { redirectTo } from "@/lib/http";
import { checkCredentials } from "@/lib/auth";
import { getSession } from "@/lib/session";

/** Only same-site paths, so ?next= cannot send the user to another site. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");

  if (!(await checkCredentials(username, password))) {
    const next = safeNext(form.get("next"));
    return redirectTo(`/login?error=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  }
  const session = await getSession();
  session.user = username;
  session.loggedInAt = Date.now();
  await session.save();
  return redirectTo(safeNext(form.get("next")));
}
