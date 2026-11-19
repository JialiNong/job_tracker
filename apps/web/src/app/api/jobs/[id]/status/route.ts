/** PATCH /api/jobs/<id>/status: set the status (stamps applied_at once; side statuses keep the record) */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError, readJsonObject } from "@/lib/http";
import { setStatus } from "@/server/tracker-writes";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJsonObject(req);
  if (!isRecordId(id)) return jsonError("Invalid job ID", 400);
  const result = await setStatus(prisma, id, body);
  return NextResponse.json(result.body, { status: result.status });
}
