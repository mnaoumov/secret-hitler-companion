import type { DeckState } from './deck.ts';

import { hypergeometricProbability } from './combinatorics.ts';
import {
  DRAW_SIZE,
  PASS_SIZE,
  Policy
} from './policy.ts';
import { getPlayerCountRules } from './rules.ts';

/** Which side a player is playing for. Hitler counts as Fascist; he wins with them. */
export enum Allegiance {
  Fascist = 'fascist',
  Liberal = 'liberal'
}

export interface AnalyseGovernmentRolesParams {
  readonly chancellorClaim: number | undefined;

  /** The pile as it stood before this government drew. */
  readonly deck: DeckState;

  readonly enacted: Policy;
  readonly playerCount: number;
  readonly presidentClaim: number | undefined;
  readonly presidentDiscard: Policy | undefined;
}

export interface GovernmentRoleOdds {
  readonly chancellor: Allegiance;
  readonly president: Allegiance;
  readonly probability: number;
}

interface IsConsistentParams {
  readonly chancellorClaim: number | undefined;
  readonly chancellorRole: Allegiance;
  readonly drawFascistCount: number;
  readonly enacted: Policy;
  readonly presidentClaim: number | undefined;
  readonly presidentDiscard: Policy | undefined;
  readonly presidentRole: Allegiance;
}

interface Pairing {
  readonly chancellor: Allegiance;
  readonly president: Allegiance;
}

const PAIRINGS: readonly Pairing[] = [
  { chancellor: Allegiance.Fascist, president: Allegiance.Fascist },
  { chancellor: Allegiance.Liberal, president: Allegiance.Fascist },
  { chancellor: Allegiance.Fascist, president: Allegiance.Liberal },
  { chancellor: Allegiance.Liberal, president: Allegiance.Liberal }
];

/**
 * How likely each pairing of allegiances is, given what this government did and said.
 *
 * The model has exactly one behavioural assumption, and it is about Liberals only:
 *
 * - **A Liberal never lies.** A claim he makes is what he held.
 * - **A Liberal always puts a Liberal law on the table when he can.** As Chancellor that means
 *   enacting the Liberal whenever one was passed to him.
 * - **A Liberal President never hands over a pair that guarantees a Fascist law.** Holding FFL he
 *   must bury the Fascist, because passing FF decides the round against his own side. Holding FLL
 *   he may bury either: LL forces a Liberal law, but FL is a legitimate play early on — it leaves
 *   the Chancellor able to enact the Liberal and makes what he does with it worth watching. So a
 *   President who passed FL is not thereby a Fascist, and the model does not treat him as one.
 *
 * A Fascist is left unconstrained in both act and word, which is the same choice the rest of the app
 * makes: a world counts if SOME Fascist behaviour explains the record, and no distribution over
 * lying is invented. So the evidence discriminates by ruling pairings out — a Liberal who could not
 * have behaved that way, or spoken that way, is not in that seat — rather than by scoring how
 * fascist a play looks.
 *
 * The prior is the seating: two distinct players drawn from a table whose composition the rules fix
 * by head count.
 */
export function analyseGovernmentRoles(params: AnalyseGovernmentRolesParams): GovernmentRoleOdds[] {
  const weights = PAIRINGS.map((pairing) =>
    getPrior(pairing.president, pairing.chancellor, params.playerCount)
    * getLikelihood(pairing.president, pairing.chancellor, params)
  );

  const total = weights.reduce((sum, weight) => sum + weight, 0);

  return PAIRINGS.map((pairing, index) => ({
    ...pairing,
    probability: total === 0 ? 0 : (weights[index] ?? 0) / total
  }));
}

/** The colours a hand of this many Fascists allows its holder to throw away. */
function getDiscardOptions(drawFascistCount: number): Policy[] {
  const options: Policy[] = [];

  if (drawFascistCount > 0) {
    options.push(Policy.Fascist);
  }

  if (drawFascistCount < DRAW_SIZE) {
    options.push(Policy.Liberal);
  }

  return options;
}

/** The colours a pass of this many Fascists allows the Chancellor to enact. */
function getEnactOptions(passFascistCount: number): Policy[] {
  const options: Policy[] = [];

  if (passFascistCount > 0) {
    options.push(Policy.Fascist);
  }

  if (passFascistCount < PASS_SIZE) {
    options.push(Policy.Liberal);
  }

  return options;
}

/** Whether these two could have produced the record from a hand of this many Fascists. */
function getIsConsistent(params: IsConsistentParams): boolean {
  const isPresidentLiberal = params.presidentRole === Allegiance.Liberal;
  const isChancellorLiberal = params.chancellorRole === Allegiance.Liberal;

  if (isPresidentLiberal && params.presidentClaim !== undefined && params.presidentClaim !== params.drawFascistCount) {
    return false;
  }

  for (const discard of getDiscardOptions(params.drawFascistCount)) {
    if (isPresidentLiberal && params.presidentDiscard !== undefined && params.presidentDiscard !== discard) {
      continue;
    }

    const passFascistCount = params.drawFascistCount - (discard === Policy.Fascist ? 1 : 0);

    /*
     * A Liberal does not hand over a pair that settles the round against him. Passing FF when FL was
     * available is the only discard that does; passing FL rather than LL leaves the Chancellor free
     * to enact the Liberal, and is a fair way to find out whether he will.
     */
    if (isPresidentLiberal && passFascistCount === PASS_SIZE && params.drawFascistCount < DRAW_SIZE) {
      continue;
    }

    if (isChancellorLiberal && params.chancellorClaim !== undefined && params.chancellorClaim !== passFascistCount) {
      continue;
    }

    for (const enacted of getEnactOptions(passFascistCount)) {
      // A Liberal puts the Liberal law up whenever one reached him.
      if (isChancellorLiberal && enacted !== (passFascistCount < PASS_SIZE ? Policy.Liberal : Policy.Fascist)) {
        continue;
      }

      if (enacted === params.enacted) {
        return true;
      }
    }
  }

  return false;
}

/**
 * The weight of the worlds this pairing can account for.
 *
 * Existential over a Fascist's choices, exactly as `analyseSession` is: a draw counts once, at its
 * full shuffle weight, if there is any way the two of them could have produced this record. It is
 * not divided among a Fascist's options, because dividing would be a claim about how often he takes
 * each one.
 */
function getLikelihood(
  presidentRole: Allegiance,
  chancellorRole: Allegiance,
  params: AnalyseGovernmentRolesParams
): number {
  let weight = 0;

  for (const [pileFascistCount, pileProbability] of params.deck.fascistCountProbabilities.entries()) {
    if (pileProbability <= 0) {
      continue;
    }

    for (let drawFascistCount = 0; drawFascistCount <= DRAW_SIZE; drawFascistCount++) {
      const drawProbability = hypergeometricProbability({
        drawSize: DRAW_SIZE,
        fascistInDraw: drawFascistCount,
        fascistInPile: pileFascistCount,
        pileSize: params.deck.size
      });

      if (drawProbability <= 0) {
        continue;
      }

      const isConsistent = getIsConsistent({
        chancellorClaim: params.chancellorClaim,
        chancellorRole,
        drawFascistCount,
        enacted: params.enacted,
        presidentClaim: params.presidentClaim,
        presidentDiscard: params.presidentDiscard,
        presidentRole
      });

      if (isConsistent) {
        weight += pileProbability * drawProbability;
      }
    }
  }

  return weight;
}

/**
 * How often this pairing sits in the government before anything is known about the round.
 *
 * Two distinct seats drawn from the table, with the number of Fascists fixed by the head count and
 * Hitler among them. It is the seating that makes the mixed pairings the common ones and both
 * Fascists the rare one, and skipping it would let a single round outweigh the make-up of the table.
 */
function getPrior(presidentRole: Allegiance, chancellorRole: Allegiance, playerCount: number): number {
  const fascistCount = getPlayerCountRules(playerCount).fascistCount + 1;
  const counts = {
    [Allegiance.Fascist]: fascistCount,
    [Allegiance.Liberal]: playerCount - fascistCount
  };

  const remaining = presidentRole === chancellorRole ? counts[chancellorRole] - 1 : counts[chancellorRole];

  return (counts[presidentRole] / playerCount) * (remaining / (playerCount - 1));
}
