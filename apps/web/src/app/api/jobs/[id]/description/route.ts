/** GET / PATCH /api/jobs/<id>/description: lazy-load or save a pasted original JD. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError, readJsonObject } from "@/lib/http";
import { getTrackerJobDescription } from "@/server/tracker-jobs";
import { setDescription } from "@/server/tracker-writes";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRecordId(id)) return jsonError("Invalid job ID", 400);
  const description = await getTrackerJobDescription(prisma, id);
  return description === null ? jsonError("Job not found", 404) : NextResponse.json({ description });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJsonObject(req);
  if (!isRecordId(id)) return jsonError("Invalid job ID", 400);
  const result = await setDescription(prisma, id, body);
  return NextResponse.json(result.body, { status: result.status });
}
