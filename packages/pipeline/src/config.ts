/**
 * Settings shared with the Python browser scrapers. The source of truth is
 * src/core/config.py; config.generated.json is exported from it
 * (scripts/tools/export_pipeline_config.py, checked by a Python unit test).
 */
import generated from "./config.generated.json" with { type: "json" };

export const config = generated;
export const DEFAULT_KEYWORDS: string[] = generated.DEFAULT_KEYWORDS;
export const API_MAX_POSTING_AGE_DAYS: number = generated.API_MAX_POSTING_AGE_DAYS;
