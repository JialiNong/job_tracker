/**
 * POST /api/jobs/<id>/run-ai: AI matching on one Tracker card, in this
 * request (no background thread). Answers with the result; 409 when the
 * card needs a local scrape first, 429 when this job is already running.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError } from "@/lib/http";
import { runAiOnCard } from "@/server/run-ai";

export const dynamic = "force-dynamic";
// One classification call plus, at most, one company web search
export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRecordId(id)) return jsonError("Invalid id", 400);
  const result = await runAiOnCard(prisma, id);
  return NextResponse.json(result.body, { status: result.status });
}
