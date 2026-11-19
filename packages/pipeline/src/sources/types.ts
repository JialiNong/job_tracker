import type { LocationPolicy } from "../location.js";

/** One listing from an API source, normalised to the jobs table (SourceJob in src/sources/base.py). */
export interface SourceJob {
  source: string; // arbeitnow / arbeitsagentur / adzuna / ats
  jobId: string;
  title: string;
  company: string;
  location: string;
  link: string;
  description?: string; // HTML or plain text; empty -> fetchDescription()
  postedAt?: Date | null;
  remote?: boolean;
  /** Extra columns: externalUrl, atsProvider, atsSlug, tags, jobTypes. */
  extra?: { externalUrl?: string; atsProvider?: string; atsSlug?: string; tags?: string[]; jobTypes?: string[] };
  fetchDescription?: () => Promise<string>;
  /** strict (global boards), lenient (DE-focused feeds), none (source is DE-only). */
  locationPolicy?: LocationPolicy;
}

export type Log = (line: string) => void;
