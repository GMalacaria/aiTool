import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts: the unit tests cover pure logic and run in
// Node, without the Cloudflare plugin.
export default defineConfig({
  test: {
    include: ['worker/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
  },
});
