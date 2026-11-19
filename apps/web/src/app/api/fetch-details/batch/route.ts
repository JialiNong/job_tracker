/** POST /api/fetch-details/batch: scraping needs the local browser scraper (phase 4). */
import { localOnly } from "@/lib/local-only";

export const dynamic = "force-dynamic";
export const POST = localOnly;
