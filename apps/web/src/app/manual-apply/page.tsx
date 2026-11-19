/** Log a Job page: the stylesheets of the old template, then the client app. */
import { Suspense } from "react";
import { Providers } from "@/components/Providers";
import { ManualApplyApp } from "@/components/manual-apply/ManualApplyApp";

export const metadata = { title: "Log Job · Job Tracker" };

// One precedence group, base.css first (see app/page.tsx)
const STYLES = [
  "/static/css/base.css",
  "/static/css/manual_apply.css",
];

export default function Page() {
  return (
    <>
      {STYLES.map((href) => <link key={href} rel="stylesheet" href={href} precedence="page" />)}
      <Providers>
        {/* useSearchParams needs a Suspense boundary */}
        <Suspense>
          <ManualApplyApp />
        </Suspense>
      </Providers>
    </>
  );
}
