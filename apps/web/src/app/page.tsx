/**
 * The Tracker page. A server component that only sets up the stylesheets and
 * the client providers; TrackerApp does the rest in the browser.
 */
import { Suspense } from "react";
import { Providers } from "@/components/Providers";
import { TrackerApp } from "@/components/tracker/TrackerApp";

export const metadata = { title: "Job Tracker" };

// Same stylesheets as templates/index.html, in the same order. One precedence
// group: React keeps the order within a group, but not across groups (the
// page's group can reach <head> before the layout's), and base.css has to
// come first for the page CSS to override it.
const STYLES = [
  "/static/css/base.css",
  "/static/css/shared/job_list.css",
  "/static/css/tracker/overview.css",
  "/static/css/tracker/flow.css",
  "/static/css/tracker/stacks.css",
  "/static/css/tracker/cards.css",
  "/static/css/tracker/index.css",
];

export default function TrackerPage() {
  return (
    <>
      {STYLES.map((href) => <link key={href} rel="stylesheet" href={href} precedence="page" />)}
      <Providers>
        {/* useSearchParams (filters live in the URL) needs a Suspense boundary */}
        <Suspense>
          <TrackerApp />
        </Suspense>
      </Providers>
    </>
  );
}
