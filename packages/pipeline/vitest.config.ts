import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration tests share one test database: run files one after another
    fileParallelism: false,
    env: { DATABASE_URL: process.env.PIPELINE_TEST_DATABASE_URL ?? "postgresql://tracker:tracker@127.0.0.1:54329/tracker_test" },
  },
});
