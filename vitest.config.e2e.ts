import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    root: "./",
    include: ["**/*.e2e-spec.ts"],
    setupFiles: ["test/setup-env.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Test files share one database and truncate it, so they run one at a time.
    fileParallelism: false,
  },
});
