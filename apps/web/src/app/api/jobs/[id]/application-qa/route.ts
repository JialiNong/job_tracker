/** PATCH /api/jobs/<id>/application-qa: replace the application Q&A pairs */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError, readJsonObject } from "@/lib/http";
import { setApplicationQa } from "@/server/tracker-writes";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJsonObject(req);
  if (!isRecordId(id)) return jsonError("Invalid job ID", 400);
  const result = await setApplicationQa(prisma, id, body);
  return NextResponse.json(result.body, { status: result.status });
}
