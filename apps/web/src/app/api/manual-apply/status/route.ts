/** GET /api/manual-apply/status?since=N: the last Log Job run. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { manualLogStatus } from "@/server/manual-log";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(await manualLogStatus(prisma, req.nextUrl.searchParams.get("since")));
}
