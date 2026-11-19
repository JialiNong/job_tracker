/** PATCH /api/jobs/<id>/timeline: replace the progress timeline and sync status / applied_at */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError, readJsonObject } from "@/lib/http";
import { setTimeline } from "@/server/tracker-writes";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJsonObject(req);
  if (!isRecordId(id)) return jsonError("Invalid job ID", 400);
  const result = await setTimeline(prisma, id, body);
  return NextResponse.json(result.body, { status: result.status });
}
