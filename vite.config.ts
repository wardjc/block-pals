import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/block-pals/',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
