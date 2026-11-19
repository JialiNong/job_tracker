/** Unmatched Jobs page: the stylesheets of the old template, then the client app. */
import { Suspense } from "react";
import { Providers } from "@/components/Providers";
import { UnmatchedApp } from "@/components/unmatched/UnmatchedApp";

export const metadata = { title: "Unmatched Jobs · Job Tracker" };

// One precedence group, base.css first (see app/page.tsx)
const STYLES = [
  "/static/css/base.css",
  "/static/css/shared/job_list.css",
  "/static/css/unmatched.css",
];

export default function Page() {
  return (
    <>
      {STYLES.map((href) => <link key={href} rel="stylesheet" href={href} precedence="page" />)}
      <Providers>
        {/* useSearchParams needs a Suspense boundary */}
        <Suspense>
          <UnmatchedApp />
        </Suspense>
      </Providers>
    </>
  );
}
