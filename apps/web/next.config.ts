import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source
  transpilePackages: ["@tracker/core", "@tracker/db", "@tracker/matching", "@tracker/pipeline"],
  // Native addon (Lingua language detection): loaded by Node at runtime, not bundled
  serverExternalPackages: ["@prospectbase/lingua"],
  // Its Linux binary is 277 MB, over Vercel's 250 MB function limit: left out
  // of the Vercel deployment, where Run AI answers "runs locally" (run-ai.ts)
  ...(process.env.VERCEL ? { outputFileTracingExcludes: { "*": ["**/@prospectbase/lingua*/**"] } } : {}),
  poweredByHeader: false,
  // The pnpm workspace root: server files are traced from here (packages/*)
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // React Compiler memoizes components and values automatically, so the code
  // does not need hand-written useMemo / useCallback
  experimental: { reactCompiler: true },
  webpack(webpackConfig) {
    // The packages use NodeNext imports ("./status.js" for status.ts)
    webpackConfig.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return webpackConfig;
  },
};

export default config;
