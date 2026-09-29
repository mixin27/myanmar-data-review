import { defineConfig } from "@playwright/test";
import workflow from "./playwright.config";
export default defineConfig({
  testDir: "./tests/production",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4174", trace: "off" },
  projects: workflow.projects!,
  webServer: {
    command: "pnpm preview:secure --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
