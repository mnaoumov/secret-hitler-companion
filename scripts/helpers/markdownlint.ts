import { glob } from 'node:fs/promises';
import { relative } from 'node:path';
import process from 'node:process';

import {
  execFromRoot,
  toPosixPath
} from './root.ts';

/*
 * The skip list lives in a file rather than on the command line, for two reasons found the hard way:
 *
 * - Repeating `--skip` does not accumulate in this version of linkinator. A second occurrence makes
 *   it skip *every* link and report "scanned 0 links" — a silent pass that checks nothing.
 * - `cmdEscapeCommandLine` in `exec.ts` prefixes every cmd metacharacter with `^` across the whole
 *   command line, quoted arguments included, so a pattern holding `(`, `)` or `|` arrives mangled.
 *   `^https?://(127\.0\.0\.1|localhost)` made cmd try to run `localhost)` as a program.
 */
const LINKINATOR_CONFIG_FILE = 'linkinator.config.json';

interface LintOptions {
  readonly paths?: string[] | undefined;
  readonly shouldFix?: boolean | undefined;
}

export async function lint(options?: LintOptions): Promise<void> {
  const { paths, shouldFix = false } = options ?? {};
  const targets = paths?.length ? paths : ['.'];
  await execFromRoot(['npx', 'markdownlint-cli2', ...(shouldFix ? ['--fix'] : []), { batchedArgs: targets }]);

  const mdFiles = paths?.length
    ? paths.map((p) => toPosixPath(relative(process.cwd(), p)) || p)
    : await toArray(glob(['**/*.md'], {
      exclude: [
        '.git/**',
        'dist/**',
        'node_modules/**'
      ]
    }));
  await execFromRoot([
    'npx',
    'linkinator',
    '--config',
    LINKINATOR_CONFIG_FILE,
    '--retry',
    '--retry-errors',
    '--retry-errors-count',
    '3',
    '--retry-errors-jitter',
    '5',
    '--url-rewrite-search',
    'https://www\\.npmjs\\.com/package/',
    '--url-rewrite-replace',
    'https://registry.npmjs.org/',
    { batchedArgs: mdFiles }
  ]);
}

async function toArray<T>(iter: AsyncIterableIterator<T>): Promise<T[]> {
  const arr: T[] = [];
  for await (const item of iter) {
    arr.push(item);
  }
  return arr;
}
