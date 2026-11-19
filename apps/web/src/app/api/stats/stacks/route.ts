/** GET /api/stats/stacks[?refresh=1]: framework / tool groups vs rejection rate (cached). */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { getStackStats, refreshStackStats } from "@/server/stacks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  return NextResponse.json(refresh ? await refreshStackStats(prisma) : await getStackStats(prisma));
}
