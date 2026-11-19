/** POST /api/timeout-jobs/<id>/match: put the posting on the Tracker as Not Applied. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError } from "@/lib/http";
import { addTimeoutToTracker } from "@/server/timeouts";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRecordId(id)) return jsonError("Invalid id", 400);
  const result = await addTimeoutToTracker(prisma, id);
  return NextResponse.json(result.body, { status: result.status });
}
