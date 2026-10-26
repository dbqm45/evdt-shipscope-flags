/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // during development, forward /api/* to the NestJS backend (npm run start:dev in the repo root)
    proxy: { "/api": "http://localhost:3000" },
  },
  test: {
    // *.test.ts(x), not *.spec.ts: the backend's Vitest collects **/*.spec.ts across the whole repository.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
  },
});
