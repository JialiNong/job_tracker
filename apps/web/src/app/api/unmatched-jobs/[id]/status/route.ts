/** PATCH /api/unmatched-jobs/<id>/status: Can Apply (watchlist) or clear it. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError, readJsonObject } from "@/lib/http";
import { setUnmatchedStatus } from "@/server/unmatched";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRecordId(id)) return jsonError("Invalid job ID", 400);
  const result = await setUnmatchedStatus(prisma, id, await readJsonObject(req));
  return NextResponse.json(result.body, { status: result.status });
}
