import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

const testDir = defineBddConfig({
  features: 'tests/e2e/features/**/*.feature',
  steps: 'tests/e2e/steps/**/*.ts',
});

export default defineConfig({
  testDir,
  globalTeardown: './tests/e2e/global-teardown.ts',
  reporter: 'html',
  fullyParallel: true,
  workers: process.env.CI ? '100%' : '50%',
  use: {
    // CRITICAL: Allows step definitions to use relative paths like page.goto('/teams')
    baseURL: 'http://localhost:5173',
    trace: 'on',
    screenshot: 'only-on-failure', // Highly recommended for vision-agent debugging
  },
  // CRITICAL: Auto-start the Vite dev server before running tests
  webServer: {
    command: 'npm run frontend:dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: {
      VITE_USE_MOCK_SUPABASE: 'true'
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});