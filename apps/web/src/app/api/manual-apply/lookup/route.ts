/** POST /api/manual-apply/lookup: where each pasted URL is already stored. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { readJsonObject } from "@/lib/http";
import { lookupUrls } from "@/server/manual-log";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const result = await lookupUrls(prisma, await readJsonObject(req));
  return NextResponse.json(result.body, { status: result.status });
}
