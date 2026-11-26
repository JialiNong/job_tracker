/**
 * Top-of-app notice when TRACKER_DEMO=1. Server component: only rendered
 * when the demo env flag is set on this deployment.
 */
import { isDemoModeSafe } from "@/lib/demo";

export function DemoBanner() {
  if (!isDemoModeSafe()) return null;
  return (
    <div className="demo-banner" role="status">
      <strong>Public demo</strong>
      <span>
        Virtual / fictional data only — not a live job search. Soft edits (status, notes, Log Job link-only)
        are rate-limited; the database resets every night. Run AI, Fetch details, and live agent ingest are
        disabled here (they need API tokens). Production stays private.
      </span>
    </div>
  );
}
