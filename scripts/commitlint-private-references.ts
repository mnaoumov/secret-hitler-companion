/**
 * @file
 *
 * A commitlint rule rejecting references that resolve only in the author's own notes.
 *
 * This project is tracked in a personal backlog kept outside the repository. Its items are named with a
 * letter and a number, sometimes with a project segment welded on, and the notes around them carry a few
 * other short identifier shapes. They are worth writing where they live and are meaningless here: this
 * repository is public, so a reader meeting one in a commit body has nothing to resolve it against, and a
 * bare letter-and-number reads as an invitation to look up an issue number that this project's own tracker
 * does not have.
 *
 * Exactly one commit body already carries one - a lone trailer, found by scanning all 51 commits on every
 * ref on 2026-09-20 - and nothing stopped it. That is what this rule is for. It runs from
 * `.husky/commit-msg`, which already invokes `commitlint --edit`, and again in CI over each pushed and
 * pull-requested range: the hook alone is bypassed by `--no-verify` and says nothing about a commit made
 * from another checkout, which is how the one that got through got through.
 *
 * **The patterns are deliberately narrower than "anything shaped like an identifier".** A plain
 * letter-plus-digits alternation matches TypeScript type parameters - `Result<T1, E>` - far more often than
 * it matches a backlog item, so a bare id is rejected only from three digits up, while the shapes that
 * cannot occur by accident are matched at any length: the project-suffixed form, the wiki link, the
 * `TODO(...)` marker and the `see ...` reference. A gate that cries wolf gets bypassed, and then it guards
 * nothing.
 *
 * Two things are deliberately absent:
 *
 * - **The backlog's project aliases.** That list lives outside this repository, so a rule that needed it
 *   could not run from a clean clone, and an alias alternation guessed at here would be both incomplete and
 *   full of false positives.
 * - **A unit test.** A positive fixture has to embed the very tokens this rule rejects, in a file that
 *   ships - which is the thing the rule exists to prevent. It is exercised instead by every commit made in
 *   this repository and by the CI step above, the same way the rest of the commitlint configuration is.
 */

import type {
  Plugin,
  SyncRule
} from '@commitlint/types';

/**
 * A single match, as {@link findPrivateReference} reports it.
 */
interface PrivateReferenceMatch {
  /**
   * The {@link PrivateReferencePattern.description} of the shape that matched.
   */
  description: string;

  /**
   * The matched text, quoted back so the committer can find it in the message.
   */
  text: string;
}

/**
 * A reference shape the commit message must not carry, and the words used to report it.
 */
interface PrivateReferencePattern {
  /**
   * What this shape is, phrased for the failure message a committer reads.
   */
  description: string;

  /**
   * The shape itself.
   */
  regExp: RegExp;
}

/**
 * The name this rule is registered and configured under.
 */
export const PRIVATE_REFERENCES_RULE_NAME = 'no-private-tracker-references';

/*
 * Ordered by how unambiguous each shape is, because the first match is the one reported and the clearest
 * report is the most specific one. The last two are the only entries that are not identifier shapes: a rule
 * or group number from the same notes, and the collective nouns those notes use for a set of repositories
 * only the author holds a list of.
 */
// cspell:ignore TSPGR
const PRIVATE_REFERENCE_PATTERNS: readonly PrivateReferencePattern[] = [
  {
    description: 'a backlog id with its project segment',
    regExp: /\b[TS]\d+-P\d+\b/
  },
  {
    description: 'a wiki link to a backlog id',
    regExp: /\[\[[TSPGR]\d+[^\]]*\]\]/
  },
  {
    description: 'a backlog id in a TODO marker',
    regExp: /(?:TODO|FIXME|HACK|NOTE)\(\s*[TSPGR]\d+/
  },
  {
    description: 'a reference to a backlog id',
    // Case-sensitive past the lead word, and `T` only: an `S` with a number after one of these words is
    // an AWS storage service far more often than a subtask, and a subtask carrying its project segment is
    // caught by the first entry anyway.
    regExp: /\b(?:[Rr]e|[Rr]efs?|[Ss]ee|[Pp]er)[:\s]\s*\[?\[?T\d+\b/
  },
  {
    description: 'a bare backlog id',
    regExp: /\bT\d{3,}\b/
  },
  {
    description: 'a numbered rule from the author\'s own notes',
    regExp: /\bG\d{2,3}\b|\bR[1-9]\b/
  },
  {
    description: 'shorthand for a group of repositories the reader has no list of',
    regExp: /\bthe fleet\b|\bfleet[- ](?:sweep|wide)\b|\bdirectory sweep\b/i
  }
];

/**
 * Finds the first private reference in a commit message.
 *
 * @param message - The whole commit message: subject, body and footers, since the one slip this rule exists
 * to stop was a trailer rather than a subject.
 * @returns The first match, or `null` when the message carries none.
 */
export function findPrivateReference(message: string): null | PrivateReferenceMatch {
  for (const pattern of PRIVATE_REFERENCE_PATTERNS) {
    const match = pattern.regExp.exec(message);

    if (match) {
      return {
        description: pattern.description,
        text: match[0]
      };
    }
  }

  return null;
}

/**
 * The commitlint plugin registering {@link PRIVATE_REFERENCES_RULE_NAME}.
 */
export const privateReferencesPlugin: Plugin = {
  rules: {
    [PRIVATE_REFERENCES_RULE_NAME]: checkPrivateReferences
  }
};

function checkPrivateReferences(parsed: Parameters<SyncRule>[0]): ReturnType<SyncRule> {
  // `raw` is the whole message as typed; the parsed fields drop the parts the parser does not recognize.
  const match = findPrivateReference(parsed['raw'] ?? '');

  if (!match) {
    return [true];
  }

  return [
    false,
    `commit message carries ${match.description} - "${match.text}" - which resolves only in notes kept outside this public repository, so it decodes to nothing for anyone reading it here. Write the observable fact instead: the counts, the dates and the mechanism are what make the message worth writing, and only the label has to change. Where an identifier is genuinely wanted, use one this repository owns - a path, a symbol, a commit hash, or an issue number from its own tracker.`
  ];
}
