import type { Linter } from 'eslint';

import { configs } from './scripts/eslint-config.ts';

/*
 * `scripts/eslint-config.ts` is kept byte-identical across the sibling repos, so app-specific
 * relaxations belong here rather than in it.
 *
 * The shared config mandates a JSDoc block on every export and an `@file` overview on every source
 * file. That is a library rule: it exists so consumers reading the published `.d.ts` get docs. This
 * project is an app with no public API, so the mandate would only produce boilerplate restating the
 * identifier. The rules that *validate* the comments we do choose to write stay on, so a comment
 * explaining a non-obvious piece of maths still has to be correct.
 */
const appConfig: Linter.Config[] = [
  {
    files: ['src/**/*.ts'],
    rules: {
      'jsdoc/require-description': 'off',
      'jsdoc/require-file-overview': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/require-yields': 'off'
    }
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {
      /*
       * These tests exist to pin exact numbers — 165/680, 0.25, 6/11. Naming each one would hide the
       * very thing under test behind an identifier, and the expected value would no longer be
       * readable next to the assertion.
       */
      'no-magic-numbers': 'off',

      // Tests are ordered to read as a narrative, not alphabetically.
      'perfectionist/sort-modules': 'off'
    }
  },
  {
    /*
     * Generated data, transcribed verbatim from the owner's spreadsheet. Every literal in it is the
     * datum itself, so there is nothing to name.
     */
    files: ['src/**/*-fixture.ts'],
    rules: {
      'no-magic-numbers': 'off'
    }
  }
];

const config: Linter.Config[] = [
  ...configs,
  ...appConfig
];

export default config;
