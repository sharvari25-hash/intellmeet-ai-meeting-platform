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
      // Test-only signing key; the real one comes from Render's env.
      JWT_SECRET: 'test-secret-test-secret-test-secret-32chars',
      // Cost 4 instead of 12: the suite hashes hundreds of passwords, and
      // deliberate slowness proves nothing in a test.
      BCRYPT_COST: '4',
      // Fake Cloudinary credentials, so signature generation can be asserted
      // without an account. Tests that cover the unconfigured path clear them.
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: '123456789012345',
      CLOUDINARY_API_SECRET: 'test-api-secret',
      CLIENT_URL: 'http://localhost:5173',
    },
    // The in-memory MongoDB is a single shared instance, so run test files
    // sequentially rather than having parallel workers fight over it.
    fileParallelism: false,
    // Per test (default 5 s). Under coverage on a 2-vCPU CI runner the
    // database-heavy tests (board moves, analytics) come close to 5 s. A
    // ceiling, not a delay: a passing test is exactly as fast as before.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      // json-summary feeds the coverage table in CI's job summary.
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // `test:coverage` (and so CI) fails below these. The plan's floor is
      // 50%; the gate sits a few points under what the suite reaches now
      // (94.6 / 85.1 / 94.6 / 94.6 at Phase 11), so a feature merged without
      // its tests is caught while normal churn is not.
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/test/**',
        // Process entry point and CLI scripts: exercised by running them, not
        // by unit tests, and counting them only dilutes the signal.
        'src/server.ts',
        'src/scripts/**',
        // Type-only module; it emits no runtime code to cover.
        'src/sockets/socket.types.ts',
      ],
    },
  },
});
