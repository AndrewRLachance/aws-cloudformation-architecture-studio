import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const configuredExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const systemChromium = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
const executablePath = configuredExecutable ?? systemChromium;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: {
        ...(executablePath ? { executablePath } : {}),
        args: ['--no-proxy-server', '--disable-dev-shm-usage', '--no-sandbox'],
      },
    },
  }],
});
