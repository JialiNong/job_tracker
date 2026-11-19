/** GET /api/journey: first apply date to today, total, and a track per job that reached an interview. */
import { NextResponse } from "next/server";
import { prisma } from "@tracker/db/client";
import { journey, loadApplicationCards } from "@/server/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(journey(await loadApplicationCards(prisma)));
}
