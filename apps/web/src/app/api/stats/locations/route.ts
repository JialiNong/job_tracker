/** GET /api/stats/locations: applications by place (Germany + Remote). */
import { NextResponse } from "next/server";
import { prisma } from "@tracker/db/client";
import { appliedLocations, loadApplicationCards } from "@/server/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(appliedLocations(await loadApplicationCards(prisma)));
}
