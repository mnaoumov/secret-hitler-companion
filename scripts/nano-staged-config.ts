/**
 * @file
 *
 * Nano-staged configuration for pre-commit hooks.
 */

import process from 'node:process';

import {
  isEnvVariableOff,
  loadEnvFileIfExists
} from './helpers/env-toggle.ts';

const NANO_STAGED_ENV_VARIABLE = 'NANO_STAGED';

const tasks: Record<string, string[]> = {
  '*': [
    'npm run spellcheck --'
  ],
  '*.{ts,tsx,mts}': [
    'npm run lint:fix --',
    'npm run format --'
  ],
  '*.md': [
    'npm run lint:md:fix --'
  ],
  /*
   * The vendored ESLint rule sources, which are hand-copies of `obsidian-dev-utils`' and are supposed to be
   * the same bytes. `lint:fix` and `format` above rewrite a staged copy in place, which is one of the three
   * ways these files drift, so this check has to read what is about to be committed — and where its key
   * sits cannot buy that. **nano-staged builds one task group per pattern and runs the groups with
   * `Promise.all`** (measured against nano-staged 1.0.2, 2026-09-19), so this group RACES `lint:fix` rather
   * than following it; sequencing exists within a single key's command list and nowhere else, which is why
   * `lint:fix` then `format` under one key really is ordered. Key order here is only what perfectionist
   * sorts it to, and says nothing about when anything runs.
   *
   * So the ordering is not enforced, it is made IRRELEVANT: the gate reads its subject out of the git index
   * rather than off disk (`scripts/helpers/git-content.ts`), which is the same bytes whether `lint:fix` has
   * run or not. Moving this key, or letting a future nano-staged order the groups differently, changes
   * nothing.
   *
   * It takes no filenames: the glob is only what decides whether it runs at all, so an ordinary commit
   * touching no vendored file fetches nothing.
   */
  '**/eslint-rules/*.ts': [
    'npm run check:vendored-eslint-rules --'
  ],
  /*
   * The shared script helpers, which are peer copies of `typescript-template`'s and are supposed to be the
   * same bytes after the transforms `scripts/check-helpers-sync.ts` records. Everything the comment above
   * says about racing `lint:fix` applies here for the same reason, and is answered the same way: the gate
   * reads the git index, so this group's position says nothing about which bytes it sees.
   *
   * The glob deliberately carries two globstars rather than one: the roster includes
   * `scripts/helpers/@types/`, and the single-star form does not reach it (measured against nano-staged
   * 1.0.2's own `globToRegex`). It therefore overlaps the key above on the `eslint-rules/` subtree, which
   * costs one extra listing call on a commit that edits a rule source and is the cheaper mistake than a
   * staged `@types` copy that nothing checks.
   */
  '**/helpers/**/*.ts': [
    'npm run check:helpers-sync --'
  ]
};

/**
 * The nano-staged task configuration, resolved with a per-developer opt-out.
 *
 * Loads a gitignored `.env` if present, then — when `NANO_STAGED` is set to an off value (`0`, `false`,
 * `off`, or `no`) — prints a notice and exits the process successfully so the pre-commit checks are skipped.
 * This mirrors husky's own `HUSKY=0` switch, but scoped to the nano-staged step (so the commit-msg hook
 * still runs). Otherwise it resolves to {@link tasks}.
 *
 * `NANO_STAGED` is not an npm script, so it carries its own switch rather than the script-name-derived one
 * every npm script gets — but both share the same notion of an off value, via {@link isEnvVariableOff}.
 */
export const config = getNanoStagedConfig();

function getNanoStagedConfig(): Record<string, string[]> {
  loadEnvFileIfExists();

  if (isEnvVariableOff(NANO_STAGED_ENV_VARIABLE)) {
    process.stdout.write(`nano-staged: skipped (${NANO_STAGED_ENV_VARIABLE} is off).\n`);
    process.exit(0);
  }

  return tasks;
}
