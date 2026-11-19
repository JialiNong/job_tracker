/** GET /api/jobs/<id>/description: the full JD, loaded when a card expands. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError } from "@/lib/http";
import { getTrackerJobDescription } from "@/server/tracker-jobs";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRecordId(id)) return jsonError("Invalid job ID", 400);
  const description = await getTrackerJobDescription(prisma, id);
  return description === null ? jsonError("Job not found", 404) : NextResponse.json({ description });
}
