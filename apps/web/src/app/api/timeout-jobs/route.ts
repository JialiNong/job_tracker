/** GET /api/timeout-jobs: cards whose job description timed out during scraping. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { listTimeouts } from "@/server/timeouts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(await listTimeouts(prisma, req.nextUrl.searchParams));
}
