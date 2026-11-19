/** PATCH /api/jobs/<id>/applicant-position: save 'I was applicant #N' */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError, readJsonObject } from "@/lib/http";
import { setApplicantPosition } from "@/server/tracker-writes";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJsonObject(req);
  if (!isRecordId(id)) return jsonError("Invalid job ID", 400);
  const result = await setApplicantPosition(prisma, id, body);
  return NextResponse.json(result.body, { status: result.status });
}
