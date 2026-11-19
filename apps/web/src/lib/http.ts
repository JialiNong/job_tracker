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
