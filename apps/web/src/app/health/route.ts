import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ service: "job-tracker", status: "ok" });
}
