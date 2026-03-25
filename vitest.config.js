import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.js',
    include: ['tests/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    exclude: ['tests/e2e/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['packages/core/src/**', 'frontend/src/hooks/**'],
      exclude: ['**/node_modules/**', 'tests/**'],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 55,
        lines: 60,
      },
    },
  },
});
