/**
 * POST /api/jobs/<id>/fetch-details: scrape the card's link in the local
 * debug Chrome and save title / company / location / description (no AI).
 * 503 on Vercel (no Chrome there), 502 when the scrape fails.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { isRecordId, jsonError } from "@/lib/http";
import { fetchDetailsForCard } from "@/server/fetch-details";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRecordId(id)) return jsonError("Invalid id", 400);
  const result = await fetchDetailsForCard(prisma, id);
  return NextResponse.json(result.body, { status: result.status });
}
