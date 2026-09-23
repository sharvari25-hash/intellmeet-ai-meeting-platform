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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/test/**', 'src/server.ts'],
    },
  },
});
