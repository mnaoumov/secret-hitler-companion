import { defineConfig } from 'vitest/config';

const SHARED_EXCLUDE = ['dist', 'node_modules'];

export const config = defineConfig({
  test: {
    coverage: {
      exclude: [
        'src/**/@types/**',
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/index.ts'
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage'
    },
    exclude: SHARED_EXCLUDE,
    globals: false,
    passWithNoTests: true,
    projects: [
      {
        test: {
          environment: 'node',
          include: ['src/**/*.test.ts'],
          name: 'unit-tests'
        }
      },
      {
        /*
         * The scripts tree, so that a test file added under `scripts/` is collected rather than silently
         * running nowhere. Nothing lives there today: the helpers whose suites it held now come from
         * `@mnaoumov/typescript-dev-toolkit`, which tests them itself.
         */
        test: {
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
          name: 'unit-tests:scripts'
        }
      }
    ]
  }
});
