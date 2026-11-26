/** GET /api/stats/agent-pushes: today's agent pushes for the Tracker banner (login required). */
import { NextResponse } from "next/server";
import { prisma } from "@tracker/db/client";
import { demoAgentPushesToday } from "@/lib/demo-agent-pushes";
import { isDemoModeSafe } from "@/lib/demo";
import { agentPushesToday } from "@/server/agent-pushes";

export const dynamic = "force-dynamic";

export async function GET() {
  // Demo has no live agent ingest; serve a fixed sample so the banner still demos.
  if (isDemoModeSafe()) return NextResponse.json(demoAgentPushesToday());
  return NextResponse.json(await agentPushesToday(prisma));
}
