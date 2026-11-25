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
        Fictional data. Soft edits (status, notes, Log Job) are rate-limited; the database resets every night.
        Production stays private.
      </span>
    </div>
  );
}
