/** GET /api/jobs: the Tracker list (filters, pagination). */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { listTrackerJobs } from "@/server/tracker-jobs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(await listTrackerJobs(prisma, req.nextUrl.searchParams));
}
