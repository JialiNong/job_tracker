/** GET /api/stats: chip counts and the pipeline rail. */
import { NextResponse } from "next/server";
import { prisma } from "@tracker/db/client";
import { trackerStats } from "@/server/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await trackerStats(prisma));
}
