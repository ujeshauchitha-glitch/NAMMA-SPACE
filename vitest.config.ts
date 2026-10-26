import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tests/*.tsx sit outside tsconfig.app.json (which carries jsx: react-jsx),
  // so tell esbuild to use the automatic JSX runtime for them.
  esbuild: { jsx: 'automatic' },
  test: {
    // spark-viewer/ and reconstruction/ are separate projects (their own deps and Python tests).
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'spark-viewer/**', 'reconstruction/**'],
  },
});
