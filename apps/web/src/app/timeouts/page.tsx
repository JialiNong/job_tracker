/** Scrape Timeouts page: the stylesheets of the old template, then the client app. */
import { Suspense } from "react";
import { Providers } from "@/components/Providers";
import { TimeoutsApp } from "@/components/timeouts/TimeoutsApp";

export const metadata = { title: "Scrape Timeouts · Job Tracker" };

// One precedence group, base.css first (see app/page.tsx)
const STYLES = [
  "/static/css/base.css",
  "/static/css/timeouts.css",
];

export default function Page() {
  return (
    <>
      {STYLES.map((href) => <link key={href} rel="stylesheet" href={href} precedence="page" />)}
      <Providers>
        {/* useSearchParams needs a Suspense boundary */}
        <Suspense>
          <TimeoutsApp />
        </Suspense>
      </Providers>
    </>
  );
}
