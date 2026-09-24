/**
 * @file
 *
 * Gate for the shared script helpers under `scripts/helpers/`.
 *
 * Those files are PEER COPIES, not this repo's own code: `typescript-template`, which this repo was scaffolded
 * from, carries the same roster, as do `obsidian-test-mocks` and `obsidian-typings-crawler`, and a change to one
 * is supposed to be a change to all of them. Nothing gated them here. `check:vendored-eslint-rules` walks for
 * the names `obsidian-dev-utils` publishes under `src/script-utils/linters/eslint-rules/`, so it can never see a
 * file here; the roster was kept in step by hand-diffing, and eight of the nine top-level files had fallen
 * behind unobserved before a manual re-sync on 2026-09-20.
 *
 * What this asserts is BYTE-IDENTITY against one peer, after a recorded transform. This file is itself a peer
 * copy of `typescript-template`'s gate, with the peer, this header and the three recorded lists changed.
 *
 * Six things it does deliberately:
 *
 * 1. **It fetches ONE peer, and the peer is `typescript-template`.** Measured 2026-09-23, it and
 *    `obsidian-test-mocks` were each byte-identical here on 6 of the 11 roster files. The template is the one
 *    chosen because it is where this gate and the helper fixes land first, because it already matched this
 *    repo's `git-content.ts`, which `obsidian-test-mocks` did not, and because it carries the tests for
 *    `eslint.ts`, `exec.ts` and `git-content.ts`, which `obsidian-test-mocks` does not all have. The other two
 *    repos are second opinions, not second gates: fetching more than one would multiply the network cost to
 *    answer the same question again.
 * 2. **The roster is the TREE `scripts/helpers/`, minus `eslint-rules/`.** One predicate ({@link isRosterPath})
 *    decides membership on both sides, so the two rosters cannot be scoped differently by accident. The
 *    carve-out is the other gate's subject: those sources are compared against `obsidian-dev-utils`, which is a
 *    different upstream and a different set of recorded deltas. `@types/` is deliberately IN - it holds shared
 *    copies too.
 * 3. **A file this repo does not carry is NOT drift.** The peer's roster is a superset by construction, so the
 *    comparison is over the intersection and anything on one side only is reported as information. Taking a
 *    peer-only helper is a decision somebody makes, not a sync a gate can demand.
 * 4. **A deliberate difference is recorded in {@link DIVERGENCE_EXCEPTIONS}, with the reason, and the record
 *    EXPIRES.** A file that differs with no exception fails; a file that is byte-identical while an exception
 *    still claims a divergence fails too, because a stale exception is a live one's hiding place. A difference
 *    that is mechanical rather than deliberate goes in {@link TRANSFORM_ARMS} instead, which reproduces this
 *    repo's copy from the peer's so that every later run enforces it. A difference that is neither - a `@file`
 *    header, which is provenance prose no transform should freeze and no exception should cost a whole file -
 *    goes in {@link HEADER_ONLY_DIVERGENCES}, which excludes the header from BOTH sides and keeps every line
 *    of code gated.
 * 5. **This repo's side is READ FROM THE INDEX** ({@link readLocalText}), not from the working tree. This runs
 *    from `nano-staged` beside `lint:fix` and `format`, which rewrite a staged file in place - one of the ways
 *    these copies drift. nano-staged builds one task group per pattern and runs the groups with `Promise.all`
 *    (measured against 1.0.2, 2026-09-19), so no key order makes this follow them; reading the index makes the
 *    ordering irrelevant rather than trying to enforce it. See `scripts/helpers/git-content.ts`. An untracked
 *    helper has no staged bytes and is read from disk.
 * 6. **The peer list comes from the peer**, as one `git/trees?recursive=1` call rather than a directory walk of
 *    the contents API: that API is not recursive, and its rate limit - 60 requests an hour per address
 *    unauthenticated - is shared with `check:vendored-eslint-rules`, which runs from the same hook and the same
 *    CI job. A truncated tree is thrown on rather than read, because a listing that silently lost entries is
 *    the one failure mode a listing exists to prevent.
 *
 * This runs from `nano-staged` on a staged helper, and also from CI. The CI half is what catches the drift
 * direction the pre-commit half cannot: a copy is only staged when somebody is editing it, so the peer moving
 * underneath a file nobody touches is invisible to a hook.
 *
 * Offline, or anywhere the fetch is unwelcome, this is turned off the way every script here is turned off:
 * `CHECK_HELPERS_SYNC=0`, via {@link exitIfScriptDisabled}. That is an explicit opt-out rather than a silent
 * skip, so a network failure is still reported as a failure.
 */

import { existsSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  join
} from 'node:path/posix';
import process from 'node:process';

import { exitIfScriptDisabled } from './helpers/env-toggle.ts';
import { splitFileHeader } from './helpers/file-header.ts';
import { readIndexContent } from './helpers/git-content.ts';
import {
  getRootFolder,
  toPosixPath
} from './helpers/root.ts';

/**
 * How one shared helper's comparison came out.
 *
 * A named union rather than a boolean, because the answers are no longer "same" and "different": a file can
 * differ under a whole-file exception, differ in nothing but its `@file` header, or differ in a way nothing
 * accounts for, and the run's closing line reports the three separately.
 */
type ComparisonOutcome = 'drift' | 'excepted' | 'headerOnly' | 'identical' | 'unavailable';

/**
 * Everything {@link compareWithoutHeader} needs about one file, gathered into an object because the six
 * values are all strings and booleans and a positional list of them is a line nobody can read.
 */
interface HeaderComparison {
  actual: string;
  expected: string;
  headerOnlyReason: string;
  isStaged: boolean;
  relativePath: string;
  scratchDirectory: string;
}

/**
 * One local copy's bytes, and where they were read from.
 *
 * The source is carried rather than inferred, because it is the difference between "this is what your commit
 * would write" and "this is what is on your disk" - and a failure message that does not say which is one a
 * reader cannot act on.
 */
interface LocalText {
  isStaged: boolean;
  text: string;
}

/**
 * One blob of the peer's recursive tree listing, narrowed to the two fields this reads.
 */
interface PeerTreeEntry {
  path: string;
  type: string;
}

/**
 * The tree listing itself, which GitHub truncates rather than paginating.
 */
interface PeerTreeResponse {
  tree: PeerTreeEntry[];
  truncated: boolean;
}

/**
 * The two paths a differing file's sides were parked at, for a failure message to point the reader at.
 */
interface ScratchSides {
  actualPath: string;
  expectedPath: string;
}

/**
 * What an arm does to the peer's text.
 *
 * Held as an alias rather than written inline as a member's type on purpose: this file is itself the shape the
 * downstream repos adopt, and they do not all agree on `@typescript-eslint/method-signature-style` - a function
 * PROPERTY signature is an error in one and a method shorthand is an error in another. A member typed by an
 * alias is neither, so the same file lints clean in all of them.
 */
type TransformApply = (text: string) => string;

/**
 * A mechanical divergence between the peer's copy and this repo's, expressed as the transform that reproduces
 * this repo's from the peer's.
 *
 * An empty `paths` means the arm applies to every shared file.
 */
interface TransformArm {
  apply: TransformApply;
  paths: readonly string[];
  reason: string;
}

/**
 * The deliberate divergences, each with the reason it is allowed to exist.
 *
 * Keyed by the repo-relative path, which both repos spell identically - the roster sits at `scripts/helpers/`
 * in each of them, so there is no rename map to maintain.
 *
 * An entry is a claim that expires: see {@link compareHelper} for the two ways it fails.
 *
 * **Empty is the correct state for this repo today.** Every difference from this peer is either mechanical,
 * and so a {@link TRANSFORM_ARMS} arm, or header prose, and so a {@link HEADER_ONLY_DIVERGENCES} entry. Neither
 * of those costs a file its gate, and an exception would.
 */
const DIVERGENCE_EXCEPTIONS: Readonly<Record<string, string>> = {};

/*
 * The other gate's subject. Those sources are compared against `obsidian-dev-utils` by
 * `check:vendored-eslint-rules`, with their own recorded deltas, so comparing them against a peer's copies here
 * would give one file two gates that can disagree.
 */
const ESLINT_RULES_PATH_PREFIX = 'scripts/helpers/eslint-rules/';

/**
 * The files whose ONLY divergence from the peer is the leading `@file` block, each with the reason that
 * block is worded per-repo.
 *
 * This is the narrow third category, and it exists because the other two both answer a header badly. A
 * {@link TRANSFORM_ARMS} arm has to REPRODUCE this repo's copy from the peer's, so for a paragraph of prose it
 * would hold that paragraph as a literal - freezing the peer's wording as this repo's expectation and keeping
 * two copies of the text. A {@link DIVERGENCE_EXCEPTIONS} entry is per-FILE, so recording a header difference
 * stops the gate saying anything about that file's CODE for ever: `obsidian-typings-crawler` took that route
 * for `scripts/helpers/git-content.test.ts` and paid 227 ungated lines to hide a header and one package name.
 *
 * An entry here excludes the header from BOTH sides ({@link splitFileHeader}) and compares everything else
 * byte-for-byte, so it weakens the gate for prose rather than for the file. It composes with
 * {@link TRANSFORM_ARMS}, which still runs first: the crawler's case is exactly that pair - the header
 * excluded here, the package name in an arm - and nothing is left ungated.
 *
 * Like an exception, an entry EXPIRES, and {@link compareWithoutHeader} is where the three ways it does live:
 * the two copies turn out identical outright, a side carries no `@file` block for the difference to be in, or
 * the bodies differ, which is drift the entry does not cover.
 *
 * This repo's one entry is that same pair: `git-content.test.ts`, whose header here is written about this
 * checkout and whose package name is reproduced by an arm.
 */
const HEADER_ONLY_DIVERGENCES: Readonly<Record<string, string>> = {
  'scripts/helpers/git-content.test.ts': 'The header describes the checkout the suite runs in: which peer the copy came from, and how many tracked files here carry a NUL byte (none, which is why the binary case builds a scratch repo). That is per-repo by nature, and the code under it is the peer\'s.'
};

const HELPERS_PATH_PREFIX = 'scripts/helpers/';

const HTTP_STATUS_NOT_FOUND = 404;

/*
 * What `markdownlint.ts` carries here and the peer does not: the skip list's file, and the two arguments that
 * hand it to linkinator. Held as literals because an arm has to reproduce the text exactly, backslashes and
 * all.
 */
const LINKINATOR_CONFIG_BLOCK = `/*
 * The skip list lives in a file rather than on the command line, for two reasons found the hard way:
 *
 * - Repeating \`--skip\` does not accumulate in this version of linkinator. A second occurrence makes
 *   it skip *every* link and report "scanned 0 links" — a silent pass that checks nothing.
 * - On Windows, the tool resolves to a \`.cmd\` shim, and a shim re-parses the arguments cmd already
 *   handed it. A pattern holding \`|\` is split there as a pipe no matter how carefully it was
 *   escaped on the way in: \`^https?://(127\\.0\\.0\\.1|localhost)\` made cmd try to run \`localhost)\`
 *   as a program. \`exec.ts\` is not at fault — the same argument reaches a real \`.exe\` intact.
 */
const LINKINATOR_CONFIG_FILE = 'linkinator.config.json';
`;

const LINKINATOR_CONFIG_ARGUMENTS = '    \'--config\',\n    LINKINATOR_CONFIG_FILE,\n';

const LINKINATOR_TOOL_LINE = '    ...resolveToolCommand({ tool: \'linkinator\' }),\n';

const LINT_OPTIONS_LINE = 'interface LintOptions {\n';

const PACKAGE_NAME_ASSERTION_PEER = 'expect(parsed.name).toBe(\'typescript-template\');';

const PACKAGE_NAME_ASSERTION_LOCAL = 'expect(parsed.name).toBe(\'secret-hitler-companion\');';

const PEER_RAW_BASE_URL = 'https://raw.githubusercontent.com/mnaoumov/typescript-template/main';

const PEER_REPO = 'mnaoumov/typescript-template';

const PEER_TREE_URL = 'https://api.github.com/repos/mnaoumov/typescript-template/git/trees/main?recursive=1';

const SCRIPT_NAME = 'check:helpers-sync';

/**
 * The recorded mechanical divergences, in the order they are applied. Any difference an arm does not account
 * for is either a recorded exception or drift.
 *
 * An arm belongs here only when the difference can be REPRODUCED; when it cannot, it is an exception in
 * {@link DIVERGENCE_EXCEPTIONS} and stays visible as one. An arm that stops matching leaves the peer's text
 * unchanged, so the file is then reported as drift: an arm cannot go stale silently.
 *
 * Every replacement is a function rather than a string: `String#replace` reads `$&` and friends in a
 * replacement VALUE, and these are built from constants rather than written inline.
 */
const TRANSFORM_ARMS: readonly TransformArm[] = [
  {
    apply: (text) => text.replace(/^[ \t]*\/\/ eslint-disable-next-line unicorn\/prefer-minimal-ternary\b.*\n/m, () => ''),
    paths: ['scripts/helpers/root.ts'],
    reason: 'This repo installs no `eslint-plugin-unicorn`, and ESLint fails a whole run on a directive naming a rule it cannot resolve, so the peer\'s inline `unicorn/prefer-minimal-ternary` disable is stripped. The rule-source gate strips the same directive from the vendored rules.'
  },
  {
    apply: (text) => text.replace(LINT_OPTIONS_LINE, () => `${LINKINATOR_CONFIG_BLOCK}\n${LINT_OPTIONS_LINE}`).replace(LINKINATOR_TOOL_LINE, () => `${LINKINATOR_TOOL_LINE}${LINKINATOR_CONFIG_ARGUMENTS}`),
    paths: ['scripts/helpers/markdownlint.ts'],
    reason: 'This repo hands linkinator its skip list through `linkinator.config.json`, which the peer has no equivalent of. The file is load-bearing: a repeated `--skip` does not accumulate in this linkinator version, and on Windows the `.cmd` shim splits a `|` in a pattern as a pipe. This is local intent, so it is reproduced rather than converged, and the rest of the file stays gated.'
  },
  {
    apply: (text) => text.replace(PACKAGE_NAME_ASSERTION_PEER, () => PACKAGE_NAME_ASSERTION_LOCAL),
    paths: ['scripts/helpers/git-content.test.ts'],
    reason: 'The first case reads this repository\'s own staged `package.json` and asserts its name, which is this repo\'s rather than the peer\'s.'
  }
];

const failures: string[] = [];

const information: string[] = [];

exitIfScriptDisabled();

/**
 * Every helper this repo carries, repo-relative and posix-spelled.
 *
 * A walk rather than `git ls-files`, so a helper that has been added but not yet staged is compared: this
 * roster carries no generated or gitignored output, which is the only thing a walk would pick up wrongly.
 *
 * @param root - The repository root the walk starts at.
 * @returns Every roster path, sorted, so a run's report reads the same way twice.
 */
async function collectLocalPaths(root: string): Promise<string[]> {
  const helpersFolder = join(root, HELPERS_PATH_PREFIX);
  if (!existsSync(helpersFolder)) {
    return [];
  }

  const found: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }

      const relativePath = path.slice(root.length + 1);
      if (isRosterPath(relativePath)) {
        found.push(relativePath);
      }
    }
  }

  await walk(helpersFolder);
  return found.toSorted((left, right) => left.localeCompare(right));
}

/**
 * Compares one shared helper against the peer's bytes after the recorded transforms.
 *
 * The two ways a {@link DIVERGENCE_EXCEPTIONS} entry fails are both here: a file that differs with no entry is
 * drift, and a file that matches while an entry still claims a divergence is an entry that has outlived what it
 * described. The second is the half that keeps the list from becoming a place to park things, and a
 * {@link HEADER_ONLY_DIVERGENCES} entry expires the same way.
 *
 * @param relativePath - The helper's path, relative to the repository root.
 * @param root - The repository root.
 * @param scratchDirectory - Where both sides of a differing file are written for the reader to diff.
 * @returns How the comparison came out.
 */
async function compareHelper(relativePath: string, root: string, scratchDirectory: string): Promise<ComparisonOutcome> {
  const peerText = await fetchPeerText(relativePath);
  if (peerText === null) {
    failures.push(`${relativePath} is in ${PEER_REPO}'s tree listing, and ${PEER_RAW_BASE_URL} does not serve it, so nothing could be compared.`);
    return 'unavailable';
  }

  const expected = transform(peerText, relativePath);
  const { isStaged, text: actual } = await readLocalText(root, relativePath);
  const exception = DIVERGENCE_EXCEPTIONS[relativePath];
  const headerOnlyReason = HEADER_ONLY_DIVERGENCES[relativePath];

  if (actual === expected) {
    if (exception !== undefined) {
      failures.push(
        `${relativePath} is byte-identical to ${PEER_REPO}'s copy, and DIVERGENCE_EXCEPTIONS still records a divergence in it: ${exception} Delete that entry - a divergence that has gone away has to stop being claimed, or the next real one hides behind it.`
      );
    }

    if (headerOnlyReason !== undefined) {
      failures.push(
        `${relativePath} is byte-identical to ${PEER_REPO}'s copy, header and all, and HEADER_ONLY_DIVERGENCES still records a header difference in it: ${headerOnlyReason} Delete that entry - the two copies now say the same thing in the same words, and an entry claiming otherwise is where the next real difference hides.`
      );
    }

    return 'identical';
  }

  if (headerOnlyReason !== undefined) {
    return await compareWithoutHeader({ actual, expected, headerOnlyReason, isStaged, relativePath, scratchDirectory });
  }

  const { actualPath, expectedPath } = await writeComparisonSides(relativePath, scratchDirectory, expected, actual, isStaged);

  if (exception === undefined) {
    failures.push(
      `${relativePath} differs from ${PEER_REPO}'s copy after the recorded transform. See how with \`git diff --no-index ${expectedPath} ${actualPath}\` - the right-hand side is ${isStaged ? `the STAGED ${relativePath}, which is what a commit would write` : `${relativePath} as it sits on disk, because it is untracked`}.`
    );
    return 'drift';
  }

  return 'excepted';
}

/**
 * Compares a file recorded in {@link HEADER_ONLY_DIVERGENCES}, with the leading `@file` block excluded from
 * both sides.
 *
 * Reached only for a file that already differs, so the entry is never asked to justify itself twice: the
 * identical case, where the entry is stale, is settled in {@link compareHelper} before this is called.
 *
 * The missing-header case is a failure rather than a fall-through to a whole-file comparison. An entry says
 * the difference is IN the header; a side with no header cannot be telling the truth about that, and quietly
 * comparing the whole file instead would turn a wrong entry into a silently stricter gate that nobody asked
 * for and nobody would understand the next time it fired.
 *
 * @param options - The two sides, the recorded reason, and where to park the bodies for the reader.
 * @returns `headerOnly` when nothing but the header differs, `drift` otherwise.
 */
async function compareWithoutHeader(options: HeaderComparison): Promise<ComparisonOutcome> {
  const { actual, expected, headerOnlyReason, isStaged, relativePath, scratchDirectory } = options;
  const peerSplit = splitFileHeader(expected);
  const localSplit = splitFileHeader(actual);

  if (peerSplit.header === null || localSplit.header === null) {
    let missingSide = 'this repo\'s copy does not open with an `@file` block';
    if (peerSplit.header === null) {
      missingSide = localSplit.header === null
        ? `neither ${PEER_REPO}'s copy nor this repo's opens with an \`@file\` block`
        : `${PEER_REPO}'s copy does not open with an \`@file\` block`;
    }

    failures.push(
      `${relativePath} is recorded in HEADER_ONLY_DIVERGENCES, and ${missingSide}, so the difference that entry describes has nowhere to be: ${headerOnlyReason} Restore the header, or move the entry to DIVERGENCE_EXCEPTIONS and accept that it stops gating the file's code.`
    );
    return 'drift';
  }

  if (peerSplit.body === localSplit.body) {
    return 'headerOnly';
  }

  const { actualPath, expectedPath } = await writeComparisonSides(relativePath, scratchDirectory, peerSplit.body, localSplit.body, isStaged);
  failures.push(
    `${relativePath} differs from ${PEER_REPO}'s copy OUTSIDE its \`@file\` header, which is the one thing its HEADER_ONLY_DIVERGENCES entry says it does not: ${headerOnlyReason} See how with \`git diff --no-index ${expectedPath} ${actualPath}\` - both sides have had their header cut off, so what is left is the code the entry claims is shared, and the right-hand side is ${isStaged ? `the STAGED ${relativePath}` : `${relativePath} as it sits on disk, because it is untracked`}.`
  );
  return 'drift';
}

/**
 * Reads one helper from the peer.
 *
 * @param relativePath - The helper's path, which both repos spell the same way.
 * @returns The peer's text, or `null` when the peer does not serve that path.
 */
async function fetchPeerText(relativePath: string): Promise<null | string> {
  const response = await fetch(`${PEER_RAW_BASE_URL}/${relativePath}`);
  if (response.ok) {
    return await response.text();
  }

  if (response.status === HTTP_STATUS_NOT_FOUND) {
    return null;
  }

  throw new Error(`Could not read ${relativePath} from ${PEER_RAW_BASE_URL}: HTTP ${String(response.status)} ${response.statusText}.`);
}

/**
 * Lists the peer's roster.
 *
 * One recursive tree call rather than a per-directory contents listing - see the file header for why, and for
 * why a truncated answer is thrown on. A `GITHUB_TOKEN` in the environment is used when there is one, which is
 * what makes this survive a CI runner whose address has already spent the unauthenticated allowance.
 *
 * @returns Every roster path the peer publishes, sorted.
 */
async function getPeerPaths(): Promise<string[]> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
  if (token !== undefined) {
    headers['authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(PEER_TREE_URL, { headers });
  if (!response.ok) {
    throw new Error(
      `Could not list ${PEER_REPO}'s tree at ${PEER_TREE_URL}: HTTP ${String(response.status)} ${response.statusText}. A 403 here is almost always GitHub's unauthenticated rate limit; set GITHUB_TOKEN, or turn this check off for the run with CHECK_HELPERS_SYNC=0.`
    );
  }

  const listing = await response.json() as PeerTreeResponse;

  if (listing.truncated) {
    throw new Error(`${PEER_TREE_URL} returned a truncated tree, so the peer's roster cannot be trusted.`);
  }

  const paths = listing.tree
    .filter((entry) => entry.type === 'blob' && isRosterPath(entry.path))
    .map((entry) => entry.path)
    .toSorted((left, right) => left.localeCompare(right));

  if (paths.length === 0) {
    throw new Error(`${PEER_TREE_URL} listed no files under ${HELPERS_PATH_PREFIX}, so this check would have compared nothing.`);
  }

  return paths;
}

/**
 * Where one side of a file's comparison is parked.
 *
 * Both sides are written out rather than only the peer's, because this repo's side is read from the index and
 * so is not readable as a path - see {@link readLocalText}.
 *
 * The path is flattened rather than nested, so the scratch directory needs no subdirectories.
 *
 * @param relativePath - The helper's path relative to the repository root.
 * @param scratchDirectory - The directory both sides are written into.
 * @param side - Which of the two sides this path is for.
 * @returns The path that side is written to.
 */
function getScratchPath(relativePath: string, scratchDirectory: string, side: 'disk' | 'peer' | 'staged'): string {
  return join(scratchDirectory, `${side}__${relativePath.replaceAll('/', '__')}`);
}

/**
 * Decides whether a path is part of the shared roster, for both repos at once.
 *
 * @param path - A repo-relative posix path.
 * @returns Whether this gate is about that file.
 */
function isRosterPath(path: string): boolean {
  return path.startsWith(HELPERS_PATH_PREFIX) && !path.startsWith(ESLINT_RULES_PATH_PREFIX) && path.endsWith('.ts');
}

async function main(): Promise<void> {
  const rootFolder = getRootFolder();
  if (rootFolder === null) {
    console.error(`${SCRIPT_NAME} could not find the repository root.`);
    process.exitCode = 1;
    return;
  }

  const root = toPosixPath(rootFolder);
  const peerPaths = await getPeerPaths();
  const localPaths = await collectLocalPaths(root);
  const sharedPaths = localPaths.filter((path) => peerPaths.includes(path));

  /*
   * A repo that carries no shared helpers has no business running this, and a roster that suddenly holds
   * nothing is far more likely to be a broken walk than a deleted tree. Either way it is reported rather than
   * passed.
   */
  if (sharedPaths.length === 0) {
    console.error(
      `${SCRIPT_NAME} found no helper shared with ${PEER_REPO} at all, which is not a state this repo is expected to reach: it walked ${String(localPaths.length)} local file(s) under ${HELPERS_PATH_PREFIX} against ${String(peerPaths.length)} of the peer's.`
    );
    process.exitCode = 1;
    return;
  }

  reportUnsharedPaths(peerPaths, localPaths, sharedPaths);
  reportStaleEntries('DIVERGENCE_EXCEPTIONS', DIVERGENCE_EXCEPTIONS, sharedPaths);
  reportStaleEntries('HEADER_ONLY_DIVERGENCES', HEADER_ONLY_DIVERGENCES, sharedPaths);
  reportUnusableEntries();

  const scratchDirectory = toPosixPath(join(tmpdir(), 'check-helpers-sync', basename(root)));
  await mkdir(scratchDirectory, { recursive: true });

  const counts: Record<ComparisonOutcome, number> = { drift: 0, excepted: 0, headerOnly: 0, identical: 0, unavailable: 0 };
  for (const relativePath of sharedPaths) {
    counts[await compareHelper(relativePath, root, scratchDirectory)]++;
  }

  report(sharedPaths.length, counts);
}

/**
 * Reads one helper as it is about to be committed.
 *
 * The index rather than the working tree - see the file header, and `scripts/helpers/git-content.ts` for the
 * nano-staged measurement behind it. The fallback to disk is not a safety net: this gate finds its files by
 * WALKING, deliberately, so a helper that has been added but not yet `git add`ed is an ordinary case, and disk
 * is the only place its bytes exist.
 *
 * @param root - The repository root.
 * @param relativePath - The helper's path relative to `root`.
 * @returns The bytes to compare, and whether they came from the index.
 */
async function readLocalText(root: string, relativePath: string): Promise<LocalText> {
  const staged = await readIndexContent(root, relativePath);
  return staged === null
    ? { isStaged: false, text: await readFile(join(root, relativePath), 'utf-8') }
    : { isStaged: true, text: staged.toString('utf-8') };
}

/**
 * Prints the run's notes, its failures and its closing line.
 *
 * @param sharedCount - How many helpers were compared.
 * @param counts - How those comparisons came out.
 */
function report(sharedCount: number, counts: Readonly<Record<ComparisonOutcome, number>>): void {
  if (information.length > 0) {
    console.log(`${SCRIPT_NAME} notes ${String(information.length)} thing(s), none of which it fails on:`);
    for (const note of information) {
      console.log(`  - ${note}`);
    }

    console.log('');
  }

  if (failures.length === 0) {
    console.log(
      `${SCRIPT_NAME} passed: ${String(sharedCount)} helper(s) shared with ${PEER_REPO}, ${String(counts.identical)} of them byte-identical after the recorded transform(s), ${String(counts.headerOnly)} identical once the \`@file\` header was excluded from both sides, and ${String(counts.excepted)} differing under a recorded exception.`
    );
    return;
  }

  console.error(`${SCRIPT_NAME} found ${String(failures.length)} problem(s) across ${String(sharedCount)} shared helper(s):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }

  console.error('');
  console.error(
    `These files are peer copies, shared byte-for-byte with ${PEER_REPO}. Take the peer's bytes, or push this repo's to it; where the difference is deliberate, record it as a DIVERGENCE_EXCEPTIONS entry in this script - where it is mechanical, as a TRANSFORM_ARMS arm - and where it is nothing but the \`@file\` header's per-repo prose, as a HEADER_ONLY_DIVERGENCES entry, which keeps the file's code gated. Each of the three makes every later run enforce the difference instead of reporting it.`
  );

  console.error('');
  console.error(
    `The ${String(TRANSFORM_ARMS.length)} mechanical divergence(s) applied to the peer's text before the comparison, so a difference matching one of them is never reported above:`
  );
  for (const arm of TRANSFORM_ARMS) {
    console.error(`  - ${arm.paths.length === 0 ? 'every shared helper' : arm.paths.join(', ')}: ${arm.reason}`);
  }

  console.error('');
  console.error(`The ${String(Object.keys(DIVERGENCE_EXCEPTIONS).length)} deliberate divergence(s) already recorded:`);
  for (const [path, reason] of Object.entries(DIVERGENCE_EXCEPTIONS)) {
    console.error(`  - ${path}: ${reason}`);
  }

  console.error('');
  console.error(
    `The ${String(Object.keys(HEADER_ONLY_DIVERGENCES).length)} file(s) compared with the \`@file\` header excluded from both sides, whose code is gated in full:`
  );
  for (const [path, reason] of Object.entries(HEADER_ONLY_DIVERGENCES)) {
    console.error(`  - ${path}: ${reason}`);
  }

  process.exitCode = 1;
}

/**
 * Reports an entry naming a file this gate no longer compares.
 *
 * An entry whose file has left the roster on either side says nothing true any more, and it would go on saying
 * it forever: nothing else here ever reads that key.
 *
 * @param listName - Which list the entry is in, so the message names what to edit.
 * @param entries - That list.
 * @param sharedPaths - The paths actually being compared.
 */
function reportStaleEntries(listName: string, entries: Readonly<Record<string, string>>, sharedPaths: readonly string[]): void {
  for (const recordedPath of Object.keys(entries)) {
    if (!sharedPaths.includes(recordedPath)) {
      failures.push(
        `${listName} records ${recordedPath}, which is not a shared helper: this repo or ${PEER_REPO} no longer carries it, so nothing compares it and the entry can never expire on its own. Delete the entry.`
      );
    }
  }
}

/**
 * Notes the files that exist on one side only.
 *
 * Neither is a failure. The peer's roster is a superset by construction, and this repo is where a helper is
 * sometimes written first; a gate cannot tell either of those from a rename, so it says what it sees and leaves
 * the judgement to a reader.
 *
 * @param peerPaths - The peer's roster.
 * @param localPaths - This repo's roster.
 * @param sharedPaths - The intersection, which is what is actually compared.
 */
function reportUnsharedPaths(peerPaths: readonly string[], localPaths: readonly string[], sharedPaths: readonly string[]): void {
  const peerOnly = peerPaths.filter((path) => !sharedPaths.includes(path));
  if (peerOnly.length > 0) {
    information.push(`${PEER_REPO} carries ${String(peerOnly.length)} helper(s) this repo does not, which is not drift: ${peerOnly.join(', ')}.`);
  }

  const localOnly = localPaths.filter((path) => !sharedPaths.includes(path));
  if (localOnly.length > 0) {
    information.push(
      `${String(localOnly.length)} helper(s) here pair with nothing in ${PEER_REPO}, so this gate says nothing about them either way - they are this repo's own, or a copy under a name nothing pairs: ${localOnly.join(', ')}.`
    );
  }
}

/**
 * Reports a file both lists claim.
 *
 * The two claims contradict each other - "the whole file may differ" against "nothing but the header may" -
 * and which of them was in force would come down to the order {@link compareHelper} happens to test them in,
 * which is no way to decide what a gate asserts.
 */
function reportUnusableEntries(): void {
  for (const recordedPath of Object.keys(HEADER_ONLY_DIVERGENCES)) {
    if (DIVERGENCE_EXCEPTIONS[recordedPath] !== undefined) {
      failures.push(
        `${recordedPath} is recorded in both DIVERGENCE_EXCEPTIONS and HEADER_ONLY_DIVERGENCES, which say different things about it: the first allows the whole file to differ, the second allows nothing but the \`@file\` header to. Delete whichever is not true - keep the narrower one if the code really is shared, since the other costs that file's code its gate.`
      );
    }
  }
}

/**
 * Applies every arm that claims this file, in the order they are recorded.
 *
 * @param peerText - The peer's bytes.
 * @param relativePath - The file's path, which decides which arms claim it.
 * @returns What this repo's copy is supposed to hold.
 */
function transform(peerText: string, relativePath: string): string {
  let text = peerText;
  for (const arm of TRANSFORM_ARMS) {
    if (arm.paths.length === 0 || arm.paths.includes(relativePath)) {
      text = arm.apply(text);
    }
  }

  return text;
}

/**
 * Parks both sides of a differing file where a reader can diff them.
 *
 * Both sides are written rather than only the peer's, because this repo's side is read from the index and so
 * is not readable as a path - see {@link readLocalText}. What is written is whatever was COMPARED, which for a
 * {@link HEADER_ONLY_DIVERGENCES} file is the two bodies rather than the two files: a diff of the whole files
 * would open on the header difference the entry exists to allow, which is the one thing the reader does not
 * need to see.
 *
 * @param relativePath - The helper's path relative to the repository root.
 * @param scratchDirectory - The directory both sides are written into.
 * @param expected - What this repo's copy was supposed to hold.
 * @param actual - What it holds.
 * @param isStaged - Whether this repo's side came from the index, which names its file.
 * @returns Where each side was written.
 */
async function writeComparisonSides(
  relativePath: string,
  scratchDirectory: string,
  expected: string,
  actual: string,
  isStaged: boolean
): Promise<ScratchSides> {
  const expectedPath = getScratchPath(relativePath, scratchDirectory, 'peer');
  await writeFile(expectedPath, expected);

  const actualPath = getScratchPath(relativePath, scratchDirectory, isStaged ? 'staged' : 'disk');
  await writeFile(actualPath, actual);

  return { actualPath, expectedPath };
}

await main();
