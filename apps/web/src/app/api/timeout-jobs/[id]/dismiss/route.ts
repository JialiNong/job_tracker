/** POST /api/timeout-jobs/<id>/dismiss: hide it from the review list. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError } from "@/lib/http";
import { dismissTimeout } from "@/server/timeouts";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRecordId(id)) return jsonError("Invalid id", 400);
  const result = await dismissTimeout(prisma, id);
  return NextResponse.json(result.body, { status: result.status });
}
