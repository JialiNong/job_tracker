/** GET /api/unmatched-jobs: postings scored below the cut-off, paginated. */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tracker/db/client";
import { listUnmatched } from "@/server/unmatched";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(await listUnmatched(prisma, req.nextUrl.searchParams));
}
