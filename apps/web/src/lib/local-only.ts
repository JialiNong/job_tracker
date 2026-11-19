import { NextResponse } from "next/server";

/** Same message as Flask on Render: scraping needs the browser, which only runs locally. */
export const PLAYWRIGHT_UNAVAILABLE = "Playwright not available on this server, run locally";

export const localOnly = () => NextResponse.json({ ok: false, error: PLAYWRIGHT_UNAVAILABLE }, { status: 503 });
