import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * Locally it uses the installed Chrome (`channel: 'chrome'`) and the dev
 * servers, so `npx playwright install` is not a prerequisite on a machine that
 * already has Chrome, and a running `npm run dev` is reused.
 *
 * CI (.github/workflows/ci.yml) changes two things with environment variables,
 * because a hosted runner for a private repository has 2 CPUs to share
 * between two browsers encoding fake camera video, the API, the web server,
 * MongoDB and Redis:
 *
 * - `E2E_CHANNEL=bundled`: Playwright's own headless Chromium (the runner has
 *   no Chrome), the lighter headless shell rather than the full browser.
 * - `E2E_SERVE=build`: the production build (`node dist/server.js` and
 *   `vite preview`) instead of `tsx watch` and the Vite dev server, which
 *   transforms and serves hundreds of unbundled modules to every new browser
 *   context. A rehearsal on 2 CPUs with the dev servers starved the WebRTC
 *   specs (the camera took over 15 s to start). It is also closer to what
 *   users get.
 *
 * The suite drives real getUserMedia, so it relies on Chrome's fake devices:
 * without them every run would either prompt for permission or capture an
 * actual webcam.
 */
const ci = Boolean(process.env.CI);
const channel = process.env.E2E_CHANNEL ?? 'chrome';
const serveBuild = process.env.E2E_SERVE === 'build';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  // Deletes the demo guests the specs created, and with them the meetings
  // they hosted, so runs do not litter the shared demo workspace.
  globalTeardown: './e2e/globalTeardown.ts',
  // One spec at a time: they all work inside the one seeded demo team, share
  // the seeded team-mate's account and draw on one IP's rate-limit budget.
  workers: 1,
  fullyParallel: false,
  // Ceilings, doubled on a CI runner, which is several times slower than a
  // laptop. The specs' own tight budgets (a peer connection within 4.5 s)
  // are set in the specs and do not change.
  timeout: ci ? 120_000 : 60_000,
  expect: { timeout: ci ? 30_000 : 15_000 },
  // One retry in CI, where a shared runner can stall for reasons that are not
  // the code's. A test that only passes on its retry is reported as "flaky"
  // in the summary and the HTML report, with a trace of the failed attempt.
  retries: ci ? 1 : 0,
  reporter: ci
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',

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
        channel: channel === 'bundled' ? undefined : channel,
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
   * MongoDB and Redis must be up first (`docker compose up -d`). With
   * E2E_SERVE=build, `npm run build` must have run; `vite preview` uses the
   * same /api and /socket.io proxy as the dev server.
   */
  webServer: [
    {
      command: serveBuild ? 'npm run start -w @intellmeet/server' : 'npm run dev:server',
      url: 'http://localhost:5000/api/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: serveBuild
        ? 'npm run preview -w @intellmeet/client -- --port 5173 --strictPort'
        : 'npm run dev:client',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
