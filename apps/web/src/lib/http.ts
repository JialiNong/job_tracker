import { NextResponse } from "next/server";

/** Ids are the 24-hex Mongo ObjectIds kept as primary keys (docs/pg-schema.md, D3). */
export const isRecordId = (id: string) => /^[0-9a-f]{24}$/.test(id);

export const jsonError = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

export function intParam(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}
