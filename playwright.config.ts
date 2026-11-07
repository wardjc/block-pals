import { defineConfig } from '@playwright/test';

// E2E_PORT lets a second checkout run e2e while another preview holds 4173.
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/block-pals/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
