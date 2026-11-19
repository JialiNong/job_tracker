import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Job Tracker",
  icons: { icon: "/static/img/logo.svg", apple: "/static/img/apple-touch-icon.png" },
};

// Same fonts as templates/_shell.html: Garamond for names, Jakarta for the UI.
const FONTS =
  "https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,500;0,600;0,700;1,500"
  + "&family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
        <link rel="stylesheet" href="/static/css/base.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
