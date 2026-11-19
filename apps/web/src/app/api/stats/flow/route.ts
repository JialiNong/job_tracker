/** GET /api/stats/flow: Sankey (one current path per application) + weekly applications by platform. */
import { NextResponse } from "next/server";
import { prisma } from "@tracker/db/client";
import { flowCharts, loadApplicationCards } from "@/server/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(flowCharts(await loadApplicationCards(prisma)));
}
