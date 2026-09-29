import { defineConfig } from "@playwright/test";
import workflow from "./playwright.config";
export default defineConfig({
  testDir: "./tests/production",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4175", trace: "off" },
  projects: workflow.projects!,
});
