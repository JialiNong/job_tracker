/** GET /api/fetch-details/ids: cards that can Fetch details / Run AI for the list filters. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { DEMO_BLOCKED_MESSAGE, isDemoMode } from "@/lib/demo";
import { jsonError } from "@/lib/http";
import { fetchDetailTargets } from "@/server/fetch-targets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (isDemoMode()) return jsonError(DEMO_BLOCKED_MESSAGE, 503);
  return NextResponse.json(await fetchDetailTargets(prisma, req.nextUrl.searchParams));
}
