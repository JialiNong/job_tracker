/** POST /api/jobs/batch-delete: delete many cards, body {"ids": [...]} (max 80). */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { readJsonObject } from "@/lib/http";
import { batchDelete } from "@/server/tracker-writes";

export async function POST(req: NextRequest) {
  const result = await batchDelete(prisma, await readJsonObject(req));
  return NextResponse.json(result.body, { status: result.status });
}
