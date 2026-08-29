import type { ProbabilityBounds } from './session.ts';

import {
  DRAW_SIZE,
  formatHand,
  PASS_SIZE,
  Policy
} from './policy.ts';

export interface ClaimAssessment {
  readonly bounds: ProbabilityBounds;
  readonly verdict: ClaimVerdict;
}

/**
 * What the combinatorics can say about a claim on its own.
 *
 * `forced` and `impossible` are the assumption-free verdicts: they hold under either discard model,
 * because they describe worlds that exist or do not, rather than how likely a choice was.
 */
export type ClaimVerdict = 'forced' | 'impossible' | 'possible';

export interface FindLiesParams {
  readonly chancellorFascistCount: number | undefined;
  readonly enacted: Policy | undefined;

  /** Which card the President says he discarded. Undefined until he has said. */
  readonly presidentDiscard: Policy | undefined;

  readonly presidentFascistCount: number | undefined;
}

export interface FindUnusualPlaysParams {
  readonly chancellorFascistCount: number | undefined;
  readonly enacted: Policy | undefined;

  /** Which card the President says he discarded. */
  readonly presidentDiscard: Policy | undefined;

  readonly presidentFascistCount: number | undefined;
}

/**
 * A claim proved false, and by whom.
 *
 * The distinction that matters: the enacted policy is a **public fact**, not testimony. A claim that
 * could not have produced it is refuted on its own, which names the liar. Two claims that merely
 * disagree with each other only prove that one of them lied, without saying which.
 */
export interface LieFinding {
  readonly actor: 'chancellor' | 'president' | 'unknown';
  readonly description: string;
}

/**
 * A record that breaks no rule but that optimal play would never produce.
 *
 * That is the whole definition, and it is why these are reported separately from lies: a lie is
 * refuted by a public fact, whereas this is merely something nobody with their wits about them
 * would have said.
 *
 * The oddity is in the *admission*, not the play. Taking the claim at face value, this player had a
 * Liberal option in hand and took the Fascist one — which a Liberal would not have done, and which a
 * Fascist would not have confessed to, because the covering lie was available and cheap: claim the
 * hand that left you no choice, and the record shows a forced play instead of a chosen one.
 *
 * Still not a probability, and it carries no prior about who anyone is. A distracted player, or one
 * making a point, produces the same record. Worth flagging, not worth scoring.
 */
export interface UnusualPlay {
  readonly actor: 'chancellor' | 'president';
  readonly description: string;
}

/**
 * Whether the two seats' claims can both be true.
 *
 * The President discards exactly one of his three, so the pair he passes holds either the same number
 * of Fascist policies as his hand (he discarded a Liberal) or one fewer (he discarded a Fascist). Any
 * other combination means at least one of them is lying — a provable contradiction that needs no
 * probability at all.
 */
export function areClaimsConsistent(presidentFascistCount: number, chancellorFascistCount: number): boolean {
  if (presidentFascistCount < 0 || presidentFascistCount > DRAW_SIZE) {
    return false;
  }

  if (chancellorFascistCount < 0 || chancellorFascistCount > PASS_SIZE) {
    return false;
  }

  return chancellorFascistCount === presidentFascistCount || chancellorFascistCount === presidentFascistCount - 1;
}

export function assessClaim(bounds: ProbabilityBounds): ClaimAssessment {
  return {
    bounds,
    verdict: getVerdict(bounds)
  };
}

/**
 * Whether a claimed three-card hand could have produced the enacted policy at all.
 *
 * The President passes two of his three, so he can pass on a colour only if he held one. A hand of
 * LLL cannot lead to a Fascist policy however he discards, and FFF cannot lead to a Liberal one.
 */
export function canEnactFromClaimedDraw(presidentFascistCount: number, enacted: Policy): boolean {
  return enacted === Policy.Fascist ? presidentFascistCount > 0 : presidentFascistCount < DRAW_SIZE;
}

/**
 * Whether an enacted policy can have come from the pair the Chancellor claims he held. He enacts
 * one of his two, so he cannot produce a colour he was not holding.
 */
export function canEnactFromClaimedPass(chancellorFascistCount: number, enacted: Policy): boolean {
  return enacted === Policy.Fascist ? chancellorFascistCount > 0 : chancellorFascistCount < PASS_SIZE;
}

/**
 * Everything the record proves about who lied.
 *
 * Checked against the public fact first, because that names a specific player. Only if neither claim
 * is refuted on its own does a mutual disagreement matter — and then all it establishes is that one
 * of the two lied. Reporting the weaker finding alongside the stronger one would discard the proof.
 */
export function findLies(params: FindLiesParams): LieFinding[] {
  const { chancellorFascistCount, enacted, presidentDiscard, presidentFascistCount } = params;
  const claimedPass = getClaimedPassFascistCount(presidentFascistCount, presidentDiscard);
  const lies: LieFinding[] = [];

  if (
    enacted !== undefined
    && chancellorFascistCount !== undefined
    && !canEnactFromClaimedPass(chancellorFascistCount, enacted)
  ) {
    lies.push({
      actor: 'chancellor',
      description: `holding ${formatHand(chancellorFascistCount, PASS_SIZE)} he could not have enacted the ${describePolicy(enacted)} law that is on the table`
    });
  }

  /*
   * Once he has said what he discarded, his account can be tested against the board directly: the pair
   * he says he handed over either could have produced the enacted policy or could not. That is a
   * sharper test than the hand alone, which only ever fails for FFF and LLL.
   */
  if (enacted !== undefined && claimedPass !== undefined && !canEnactFromClaimedPass(claimedPass, enacted)) {
    lies.push({
      actor: 'president',
      description: `passing ${formatHand(claimedPass, PASS_SIZE)} he could not have produced the ${describePolicy(enacted)} law that is on the table`
    });
  } else if (
    enacted !== undefined
    && claimedPass === undefined
    && presidentFascistCount !== undefined
    && !canEnactFromClaimedDraw(presidentFascistCount, enacted)
  ) {
    lies.push({
      actor: 'president',
      description: `drawing ${formatHand(presidentFascistCount, DRAW_SIZE)} he could not have passed on the ${describePolicy(enacted)} law that is on the table`
    });
  }

  if (lies.length > 0) {
    return lies;
  }

  /*
   * Neither account fails against the board on its own, so all that is left is that the two of them
   * disagree about the pair that changed hands. One of them is lying and nothing here says which.
   */
  if (claimedPass !== undefined && chancellorFascistCount !== undefined && claimedPass !== chancellorFascistCount) {
    lies.push({
      actor: 'unknown',
      description: `he says he passed ${formatHand(claimedPass, PASS_SIZE)}, the Chancellor says he was handed ${formatHand(chancellorFascistCount, PASS_SIZE)}`
    });
  } else if (
    claimedPass === undefined
    && presidentFascistCount !== undefined
    && chancellorFascistCount !== undefined
    && !areClaimsConsistent(presidentFascistCount, chancellorFascistCount)
  ) {
    lies.push({
      actor: 'unknown',
      description: `${formatHand(presidentFascistCount, DRAW_SIZE)} minus one card cannot be ${formatHand(chancellorFascistCount, PASS_SIZE)}`
    });
  }

  return lies;
}

export function findUnusualPlays(params: FindUnusualPlaysParams): UnusualPlay[] {
  const { chancellorFascistCount, enacted, presidentDiscard, presidentFascistCount } = params;
  const plays: UnusualPlay[] = [];

  /*
   * Read off the President's OWN account of what he discarded, never inferred from the Chancellor's.
   * He held a Fascist and chose to discard a Liberal, handing on a more Fascist pair than he had to.
   *
   * Inferring this from the Chancellor's claim used to put the flag on the wrong man: a Chancellor
   * who enacted the Fascist while holding a Liberal could claim the pair was FF, and the suspicion
   * landed on the President. With the discard recorded, that same story is no longer a quiet
   * re-attribution — it is an outright disagreement about the pair, and it is reported as one.
   */
  if (presidentFascistCount !== undefined && presidentFascistCount > 0 && presidentDiscard === Policy.Liberal) {
    plays.push({
      actor: 'president',
      description: 'says he discarded a Liberal while holding a Fascist — a Liberal would not have done it, and a Fascist would have claimed FFF to make the pass look forced'
    });
  }

  // The same shape one seat later: the Fascist option taken, and then admitted to.
  if (enacted === Policy.Fascist && chancellorFascistCount === 1) {
    plays.push({
      actor: 'chancellor',
      description: 'says he enacted a Fascist while holding a Liberal — a Liberal would not have done it, and a Fascist would have claimed FF to make it look forced'
    });
  }

  return plays;
}

/**
 * Which card the Chancellor put in the discard pile.
 *
 * Never asked, unlike the President's — it is already known. He holds two and plays one face up, so
 * his own claimed pair minus the policy on the table names the card he threw away. Asking would add
 * a tap whose only possible answers are the one already implied and a self-contradiction.
 *
 * `undefined` when the pair or the policy is missing, and when his claim could not have produced
 * that policy at all — a refuted claim implies nothing, and `findLies` reports it as a lie instead.
 */
export function getChancellorDiscard(
  chancellorFascistCount: number | undefined,
  enacted: Policy | undefined
): Policy | undefined {
  if (
    chancellorFascistCount === undefined
    || enacted === undefined
    || !canEnactFromClaimedPass(chancellorFascistCount, enacted)
  ) {
    return undefined;
  }

  const keptFascistCount = chancellorFascistCount - (enacted === Policy.Fascist ? 1 : 0);

  return keptFascistCount > 0 ? Policy.Fascist : Policy.Liberal;
}

/**
 * The pair the President's own account says he passed on.
 *
 * Asking him what he discarded is what makes his account complete: the hand alone does not say what
 * the Chancellor received. Without it the pair has to be read off what the CHANCELLOR claims, which
 * means a lying Chancellor silently rewrites the President's story and the two can never be told
 * apart.
 */
export function getClaimedPassFascistCount(
  presidentFascistCount: number | undefined,
  presidentDiscard: Policy | undefined
): number | undefined {
  if (presidentFascistCount === undefined || presidentDiscard === undefined) {
    return undefined;
  }

  return presidentDiscard === Policy.Fascist ? presidentFascistCount - 1 : presidentFascistCount;
}

function describePolicy(policy: Policy): string {
  return policy === Policy.Fascist ? 'Fascist' : 'Liberal';
}

function getVerdict(bounds: ProbabilityBounds): ClaimVerdict {
  if (bounds.max <= 0) {
    return 'impossible';
  }

  if (bounds.min >= 1) {
    return 'forced';
  }

  return 'possible';
}
