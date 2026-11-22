/** GET /api/stats/agent-pushes: today's agent pushes for the Tracker banner (login required). */
import { NextResponse } from "next/server";
import { prisma } from "@tracker/db/client";
import { agentPushesToday } from "@/server/agent-pushes";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await agentPushesToday(prisma));
}
