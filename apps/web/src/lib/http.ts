import { NextResponse } from "next/server";

/** Ids are the 24-hex Mongo ObjectIds kept as primary keys (docs/pg-schema.md, D3). */
export const isRecordId = (id: string) => /^[0-9a-f]{24}$/.test(id);

export const jsonError = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

export function intParam(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Like Flask's request.get_json(silent=True) or {}: a bad or non-object body reads as {}. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  try {
    const data = await req.json();
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Redirect with a relative Location. Building an absolute URL from req.url
 * can swap the host (next dev reports "localhost" for 127.0.0.1; a proxy can
 * report its own host), and the session cookie would not follow.
 */
export function redirectTo(path: string, status: 302 | 303 = 303): Response {
  return new Response(null, { status, headers: { Location: path } });
}
