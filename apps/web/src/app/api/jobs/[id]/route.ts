/** GET /api/jobs/<id>: one Tracker card (deep link /?open=<id>). */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError } from "@/lib/http";
import { getTrackerJob } from "@/server/tracker-jobs";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRecordId(id)) return jsonError("Invalid job ID", 400);
  const job = await getTrackerJob(prisma, id);
  return job ? NextResponse.json(job) : jsonError("Job not found", 404);
}
