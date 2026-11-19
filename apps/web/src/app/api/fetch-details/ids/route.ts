/** GET /api/fetch-details/ids: cards that can Fetch details / Run AI for the list filters. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { fetchDetailTargets } from "@/server/fetch-targets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(await fetchDetailTargets(prisma, req.nextUrl.searchParams));
}
