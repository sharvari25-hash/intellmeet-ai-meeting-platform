import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * Uses the locally installed Chrome (`channel: 'chrome'`) rather than
 * Playwright's bundled Chromium, so `npx playwright install` is not a
 * prerequisite on a machine that already has Chrome. Switch to
 * `...devices['Desktop Chrome']` without the channel if you prefer the
 * pinned build.
 *
 * The suite drives real getUserMedia, so it relies on Chrome's fake devices:
 * without them every run would either prompt for permission or capture an
 * actual webcam.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  // One meeting at a time: the specs sign in as the shared demo account and
  // would otherwise race each other inside the same workspace.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'off',
  },

  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: {
          args: [
            // A synthetic camera and microphone, so the mesh really negotiates
            // video without needing hardware or a human to wave at it.
            '--use-fake-device-for-media-stream',
            // Auto-accepts the permission prompt, which is modal and would
            // otherwise block the run.
            '--use-fake-ui-for-media-stream',
            // Two browser contexts on one machine talk over loopback; this
            // stops Chrome hiding local candidates behind mDNS obfuscation,
            // which would make them unroutable to each other.
            '--disable-features=WebRtcHideLocalIpsWithMdns',
          ],
        },
      },
    },
  ],

  /**
   * Started only when nothing is already listening, so a developer running
   * `npm run dev` in another terminal is reused rather than fought with.
   * MongoDB and Redis must be up first (`docker compose up -d`).
   */
  webServer: [
    {
      command: 'npm run dev:server',
      url: 'http://localhost:5000/api/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:client',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
