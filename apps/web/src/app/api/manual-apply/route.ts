/** POST /api/manual-apply: Log Job (link-only here; scrape needs a local browser). */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { readJsonObject } from "@/lib/http";
import { startManualLog } from "@/server/manual-log";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const result = await startManualLog(prisma, await readJsonObject(req));
  return NextResponse.json(result.body, { status: result.status });
}
