import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source
  transpilePackages: ["@tracker/core", "@tracker/db"],
  poweredByHeader: false,
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
