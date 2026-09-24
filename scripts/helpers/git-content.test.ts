/**
 * @file
 *
 * Tests for the index read both of this repo's byte-identity gates depend on --
 * `check:vendored-eslint-rules` and `check:helpers-sync`.
 *
 * Taken from `typescript-template` on 2026-09-23, the peer `check:helpers-sync` compares this roster against.
 * The code is the peer's. Two things differ, and both are recorded in that gate: this `@file` header, which is
 * per-repo prose, and the package name the first case asserts, which is reproduced by a transform arm.
 *
 * The fixture for everything that can use it is **this repository's own index** rather than a scratch repo:
 * those properties are properties of how `git cat-file` hands bytes back, and a repo built for the test would
 * prove them about that repo rather than about the checkout the gates actually run in.
 *
 * The two that matter most are the two reasons `readIndexContent` does not go through `execFromRoot` -- a
 * binary blob survives, and a trailing newline is not eaten. Both are silent failures waiting to happen: the
 * second would report every vendored rule source as differing from upstream by its last line.
 *
 * ## The binary case builds a scratch repo
 *
 * Measured 2026-09-23, **none of this repo's 89 tracked files contains a NUL byte**, so the fixture rule above
 * cannot reach that property here. It is the one case that builds a scratch repo, which is also what the peer
 * does, for the same reason.
 *
 * ## Outside a repository
 *
 * A path git cannot find and a folder that is not a repository both exit 128, and `isMissingPath` tells them
 * apart by the message alone: the first is reported as an absent blob, the second is thrown. The last case
 * pins that distinction.
 */

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join
} from 'node:path/posix';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import { readIndexContent } from './git-content.ts';
import {
  getRootFolder,
  toPosixPath
} from './root.ts';

/**
 * The fields this reads out of the staged `package.json`, which is only enough to prove it is that file.
 */
interface PackageManifest {
  name: string;
}

const BINARY_FIXTURE_NAME = 'blob.bin';

/*
 * `00` and `01` are a NUL and a control byte; `fe ff` can appear in no valid UTF-8 sequence at all. Between
 * them they are precisely what a `data.toString('utf-8')` round trip does not survive, and the NUL is also
 * what makes git classify the blob as binary and leave it alone.
 */
const BINARY_FIXTURE_CONTENT = Buffer.from([0x41, 0x42, 0x00, 0x01, 0xFE, 0xFF, 0x43, 0x44]);

const GIT_EXIT_FATAL = 128;

let scratchRepoFolder = '';
let nonRepoFolder = '';

/**
 * Asserts a folder is outside every git repository, which the non-repository case below assumes of `tmpdir()`.
 *
 * The walk is `getRootFolder`'s, looking for `.git` instead of `package.json` -- i.e. the same search git
 * itself reports as "not a git repository (or any of the parent directories)". A temp folder inside a
 * repository would make that case assert the missing-path branch instead, and pass for the wrong reason, so
 * it is worth a sentence rather than a silent pass.
 *
 * @param folder - The folder to check.
 */
function assertOutsideRepo(folder: string): void {
  let currentFolder = folder;
  while (currentFolder !== '.' && currentFolder !== '/') {
    if (existsSync(join(currentFolder, '.git'))) {
      throw new Error(`${folder} is inside the repository at ${currentFolder}, so it cannot stand in for a folder that is not one. The non-repository case below assumes the platform temp folder is outside every repository.`);
    }

    const parentFolder = dirname(currentFolder);
    if (parentFolder === currentFolder) {
      return;
    }

    currentFolder = parentFolder;
  }
}

/**
 * Makes a temp folder for a fixture, posix-spelled the way the rest of these helpers spell paths.
 *
 * @param prefix - The `mkdtemp` prefix, which names the fixture in whatever is left behind if a run dies.
 * @returns The folder's path.
 */
function makeTemporaryFolder(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  return toPosixPath(folder);
}

/**
 * Reads a path the fixture asserts IS tracked, failing loudly rather than handing back a nullable.
 *
 * A `null` here is not the case under test - it is the repository not looking the way this file assumes -
 * so it is worth a sentence saying so.
 *
 * @param root - The directory the path is relative to.
 * @param path - The file's path relative to `root`, posix-spelled.
 * @returns The staged bytes.
 */
async function readTracked(root: string, path: string): Promise<Buffer> {
  const content = await readIndexContent(root, path);
  if (content === null) {
    throw new Error(`${path} has no entry in the index of ${root}, which the assertion reading it assumes.`);
  }

  return content;
}

/**
 * Runs git in a fixture folder, failing loudly on a non-zero exit.
 *
 * The fixtures are built with a real git rather than by writing index bytes by hand, because what is under
 * test is agreement with git and a hand-built index would only prove agreement with this file's idea of one.
 *
 * @param folder - The folder to run git in.
 * @param gitArguments - The arguments after `-C <folder>`.
 */
function runGit(folder: string, gitArguments: readonly string[]): void {
  const result = spawnSync('git', ['-C', folder, ...gitArguments], { windowsHide: true });
  if (result.error) {
    throw new Error(`Could not run \`git ${gitArguments.join(' ')}\` while building the fixture in ${folder}.`, { cause: result.error });
  }

  if (result.status === 0) {
    return;
  }

  const exitCode = result.status === null ? '(null)' : String(result.status);
  throw new Error(`\`git ${gitArguments.join(' ')}\` failed with exit code ${exitCode} while building the fixture in ${folder}:\n${result.stderr.toString('utf-8').trim()}`);
}

beforeAll(() => {
  scratchRepoFolder = makeTemporaryFolder('git-content-repo-');
  writeFileSync(join(scratchRepoFolder, BINARY_FIXTURE_NAME), BINARY_FIXTURE_CONTENT);
  runGit(scratchRepoFolder, ['init', '--quiet']);
  runGit(scratchRepoFolder, ['add', BINARY_FIXTURE_NAME]);

  nonRepoFolder = makeTemporaryFolder('git-content-bare-');
  assertOutsideRepo(nonRepoFolder);
});

afterAll(() => {
  for (const folder of [scratchRepoFolder, nonRepoFolder]) {
    if (folder !== '') {
      rmSync(folder, { force: true, recursive: true });
    }
  }
});

describe('readIndexContent', () => {
  const root = toPosixPath(getRootFolder() ?? '');

  it('reads a tracked text file as the bytes a commit would write', async () => {
    const content = await readTracked(root, 'package.json');
    const parsed = JSON.parse(content.toString('utf-8')) as PackageManifest;
    expect(parsed.name).toBe('secret-hitler-companion');
  });

  it('keeps the trailing newline, which a stdout-trimming exec helper would eat', async () => {
    const content = await readTracked(root, 'package.json');
    expect(content.toString('utf-8').endsWith('}\n')).toBe(true);
  });

  it('returns a binary file byte for byte', async () => {
    const staged = await readTracked(scratchRepoFolder, BINARY_FIXTURE_NAME);
    expect(staged.includes(0)).toBe(true);
    expect(staged.equals(BINARY_FIXTURE_CONTENT)).toBe(true);

    /*
     * Nothing rewrites the fixture between the `git add` above and here, so its staged bytes and its bytes on
     * disk are the same file - which makes the working tree a second oracle for "nothing was mangled on the
     * way through", independent of the literal this file declares.
     */
    const onDisk = readFileSync(join(scratchRepoFolder, BINARY_FIXTURE_NAME));
    expect(staged.equals(onDisk)).toBe(true);
  });

  it('answers null for a path with no index entry, rather than throwing', async () => {
    expect(await readIndexContent(root, 'scripts/helpers/no-such-file.ts')).toBeNull();
  });

  it('answers null for a file that exists on disk but is not tracked', async () => {
    // `node_modules` is ignored, so anything under it is on disk and in no index.
    expect(await readIndexContent(root, 'node_modules/.package-lock.json')).toBeNull();
  });

  it('throws for a folder that is not a repository, rather than reporting an absent blob', async () => {
    const readingOutsideARepo = readIndexContent(nonRepoFolder, 'package.json');

    await expect(readingOutsideARepo).rejects.toThrow(`failed with exit code ${String(GIT_EXIT_FATAL)}`);
    await expect(readingOutsideARepo).rejects.toThrow('not a git repository');
  });
});
