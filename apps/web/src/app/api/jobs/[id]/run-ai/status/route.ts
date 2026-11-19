/** GET /api/jobs/<id>/run-ai/status: whether a Run AI is in progress for this card. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError } from "@/lib/http";
import { runAiStatus } from "@/server/run-ai";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRecordId(id)) return jsonError("Invalid id", 400);
  return NextResponse.json(await runAiStatus(prisma, id));
}
