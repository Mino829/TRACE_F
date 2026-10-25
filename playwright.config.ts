import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // tests/unit runs on node:test (npm run test:unit).
  testIgnore: "unit/**",
  workers: 1,
  timeout: 60000,
  use: { channel: "chrome", baseURL: process.env.TRACE_TEST_FRONTEND_URL ?? "http://127.0.0.1:3000",
    geolocation: { latitude: 35, longitude: 135, accuracy: 8 }, permissions: ["geolocation"] },
});
