import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment (the default) - this is a server suite.
    globalSetup: ['./src/test/globalSetup.ts'],
    setupFiles: ['./src/test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // Never connected to: tests inject a stub client (see setup.ts). The
      // value exists only to satisfy the zod env schema at import time.
      REDIS_URL: 'redis://localhost:6379',
      CORS_ORIGINS: 'http://localhost:5173,https://intellmeet.example',
    },
    // The in-memory MongoDB is a single shared instance, so run test files
    // sequentially rather than having parallel workers fight over it.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/test/**', 'src/server.ts'],
    },
  },
});
