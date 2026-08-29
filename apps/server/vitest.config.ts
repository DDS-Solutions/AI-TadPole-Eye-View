import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: { GEV_GOVERNANCE_DB: ':memory:' },
    include: ['test/**/*.test.ts'],
  },
});
