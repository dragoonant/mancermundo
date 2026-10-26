import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PW_PORT ?? 4173)
// Production base path (see vite.config.ts) — the preview server serves the
// build under this sub-path, matching GitHub Pages.
// PW_BASE_URL (e.g. http://localhost:5173/) points the specs at a running dev server instead of the preview build.
const BASE_URL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}/mancermundo/`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile-.*\.spec\.ts/ },
    // Phone form factors (M11): only the mobile-*.spec.ts files run here. iPhone devices use WebKit.
    { name: 'iphone-se', use: { ...devices['iPhone SE landscape'] }, testMatch: /mobile-.*\.spec\.ts/ },
    { name: 'iphone-pro', use: { ...devices['iPhone 15 Pro landscape'] }, testMatch: /mobile-.*\.spec\.ts/ },
    { name: 'pixel', use: { ...devices['Pixel 7 landscape'] }, testMatch: /mobile-.*\.spec\.ts/ },
  ],
  webServer: process.env.PW_BASE_URL ? undefined : {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
