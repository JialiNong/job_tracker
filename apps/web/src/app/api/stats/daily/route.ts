/** GET /api/stats/daily?days=120: per-day activity for the heatmap. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { intParam } from "@/lib/http";
import { dailyActivity } from "@/server/overview";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Math.max(7, Math.min(intParam(req.nextUrl.searchParams.get("days"), 120), 366));
  return NextResponse.json({ days: await dailyActivity(prisma, days) });
}
