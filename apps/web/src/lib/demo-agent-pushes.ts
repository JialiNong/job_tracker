/**
 * Fixed "today's agent pushes" payload for the public demo.
 *
 * Live agent ingest is blocked on the demo deployment (no AGENT_API_TOKEN),
 * and the nightly seed clears agent_push_runs — so the Tracker banner would
 * otherwise stay empty. This sample keeps the UI honest about how a morning
 * push looks, and is clearly marked as fictional.
 */
import { formatBerlinDate, now as clockNow } from "@tracker/core";
import type { AgentPushesToday } from "@/lib/tracker/types";

/** Hardcoded sample for TRACKER_DEMO; counts stay stable across reseeds. */
export function demoAgentPushesToday(): AgentPushesToday & { sample: true } {
  const day = formatBerlinDate(clockNow());
  return {
    sample: true,
    day,
    agents: [
      {
        agent: "cursor",
        runs: 1,
        received: 5,
        saved: 3,
        skipped: 1,
        failed: 1,
        last_at: `${day} 08:12`,
      },
      {
        agent: "claude",
        runs: 1,
        // Paperkite was already saved by Cursor; Oak Pixel was already on Unmatched → skipped
        received: 4,
        saved: 1,
        skipped: 2,
        failed: 1,
        last_at: `${day} 08:41`,
      },
    ],
    failures: [
      {
        // No /view/<id>/ path → same shape as a live no_job_id rejection
        url: "https://www.linkedin.com/jobs/search/?keywords=staff%20engineer",
        reason: "no_job_id",
        message: "Could not read a job id from this URL.",
        title: "Staff Engineer",
        company: "Mothlight",
        agent: "cursor",
        at: `${day} 08:12`,
      },
      {
        url: "https://de.indeed.com/viewjob?jk=demo000fail01",
        reason: "save_failed",
        message: "The tracker could not save this job (database error, see the server log).",
        title: "Backend Engineer",
        company: "Cinderwell",
        agent: "claude",
        at: `${day} 08:41`,
      },
    ],
    // No openable card_id: demo seed has no matching application; banner skips Open card when sample.
    needs_link: [
      {
        card_id: "a00000000000000000000001",
        url: "https://to.indeed.com/demo-short-link",
        title: "Frontend Engineer",
        company: "Northbeam",
        agent: "cursor",
      },
    ],
    items: [
      {
        outcome: "saved",
        url: "https://www.linkedin.com/jobs/view/4100999101/",
        title: "Product Engineer",
        company: "Lumen Labs",
        open_path: null,
        match_score: null,
        match_gate: "",
        origin: "agent",
        agents: ["cursor"],
      },
      {
        outcome: "saved",
        url: "https://careers.paperkite.example/jobs/fullstack-engineer",
        title: "Full-Stack Engineer",
        company: "Paperkite",
        open_path: null,
        match_score: null,
        match_gate: "",
        origin: "agent",
        agents: ["cursor", "claude"],
      },
      {
        outcome: "saved",
        url: "https://www.linkedin.com/jobs/view/4100999103/",
        title: "Frontend Engineer (TypeScript)",
        company: "Rivermark",
        open_path: null,
        match_score: null,
        match_gate: "",
        origin: "agent",
        agents: ["claude"],
      },
      {
        outcome: "tracker",
        url: "https://jobs.ashbyhq.com/softgrove/demo-fe-01",
        title: "Software Engineer, Web",
        company: "Softgrove",
        open_path: null,
        match_score: 7.2,
        match_gate: "",
        origin: "api",
        agents: ["cursor"],
      },
      {
        outcome: "unmatched",
        url: "https://www.linkedin.com/jobs/view/4100999201/",
        title: "Platform Engineer",
        company: "Oak Pixel",
        open_path: null,
        match_score: 4.1,
        match_gate: "backend_heavy",
        origin: "pipeline",
        agents: ["claude"],
      },
    ],
  };
}
