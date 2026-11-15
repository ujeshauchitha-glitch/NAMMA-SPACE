import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tests/*.tsx sit outside tsconfig.app.json (which carries jsx: react-jsx),
  // so tell esbuild to use the automatic JSX runtime for them.
  esbuild: { jsx: 'automatic' },
  test: {
    maxWorkers: 4,
    testTimeout: 20_000,
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    // `npm run test:coverage`: v8 coverage of the pure logic in src/lib (POIs, search, navigation, routes, ...).
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      reporter: ['text-summary', 'text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
