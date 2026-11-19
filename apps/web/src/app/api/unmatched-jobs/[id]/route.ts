/** GET /api/unmatched-jobs/<id>: one Unmatched posting (deep link /unmatched?open=<id>). */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError } from "@/lib/http";
import { getUnmatched } from "@/server/unmatched";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRecordId(id)) return jsonError("Invalid job ID", 400);
  const job = await getUnmatched(prisma, id);
  return job ? NextResponse.json(job) : jsonError("Unmatched job not found", 404);
}
