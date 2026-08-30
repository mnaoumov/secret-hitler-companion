import {
  combinations,
  hypergeometricProbability
} from './combinatorics.ts';
import {
  DRAW_SIZE,
  FASCIST_POLICY_COUNT,
  Policy,
  TOTAL_POLICY_COUNT
} from './policy.ts';

/**
 * What is publicly knowable about the draw pile.
 *
 * The pile's *size* is always known exactly — it starts at 17, loses three per legislative session
 * and one per election-tracker enactment, and resets on every reshuffle. Its *composition* is not:
 * each session discards two unseen cards in the discard pile. So the composition is carried as a
 * distribution over the number of Fascist policies remaining, which is at most 12 numbers.
 */
export interface DeckState {
  /** Probability the pile holds exactly this many Fascist policies, indexed by that count. */
  readonly fascistCountProbabilities: readonly number[];
  readonly size: number;
}

export function createFullDeck(): DeckState {
  return createKnownDeck(FASCIST_POLICY_COUNT, TOTAL_POLICY_COUNT);
}

export function createKnownDeck(fascistCount: number, size: number): DeckState {
  if (fascistCount < 0 || fascistCount > size) {
    throw new RangeError(`A pile of ${String(size)} cannot hold ${String(fascistCount)} Fascist policies.`);
  }

  const fascistCountProbabilities = new Array<number>(fascistCount + 1).fill(0);
  fascistCountProbabilities[fascistCount] = 1;

  return {
    fascistCountProbabilities,
    size
  };
}

export function expectedFascistCount(deck: DeckState): number {
  return deck.fascistCountProbabilities.reduce((total, probability, fascistCount) => total + probability * fascistCount, 0);
}

export function getDrawDistribution(deck: DeckState): number[] {
  const distribution = new Array<number>(DRAW_SIZE + 1).fill(0);

  for (const [fascistInPile, pileProbability] of deck.fascistCountProbabilities.entries()) {
    if (pileProbability <= 0) {
      continue;
    }

    for (let fascistInDraw = 0; fascistInDraw <= DRAW_SIZE; fascistInDraw++) {
      const drawProbability = hypergeometricProbability({
        drawSize: DRAW_SIZE,
        fascistInDraw,
        fascistInPile,
        pileSize: deck.size
      });

      distribution[fascistInDraw] = (distribution[fascistInDraw] ?? 0) + pileProbability * drawProbability;
    }
  }

  return distribution;
}

/**
 * The exact Fascist count when the composition is certain, otherwise `null`. Certainty holds at the
 * start of the game and immediately after every reshuffle.
 */
export function getExactFascistCount(deck: DeckState): null | number {
  let exact: null | number = null;

  for (const [fascistCount, probability] of deck.fascistCountProbabilities.entries()) {
    if (probability === 0) {
      continue;
    }

    if (exact !== null) {
      return null;
    }

    exact = fascistCount;
  }

  return exact;
}

/**
 * What the President will draw, straight from the pile.
 *
 * This is the owner's spreadsheet row computed live: it depends on the deck and nothing else — not
 * on what anybody claimed, not on what was enacted. It is what you want *before* voting on a
 * government, which is why it is shown whether or not a round has been entered yet.
 *
 * Indexed by the number of Fascist policies in the three drawn.
 */
/**
 * The chance the top three are exactly the sequence claimed, in that order.
 *
 * A Policy Peek is an ordered look, so a President reporting "Fascist, Fascist, Liberal" is making a
 * stronger claim than "two Fascists and a Liberal" — there are three orders that hand and only one
 * of them is his. The count distribution spreads over `C(3, k)` equally likely arrangements, so the
 * ordered chance is that share of it.
 */
export function getOrderedDrawProbability(deck: DeckState, fascistCount: number): number {
  const distribution = getDrawDistribution(deck);
  const arrangements = combinations(DRAW_SIZE, fascistCount);

  if (arrangements === 0) {
    return 0;
  }

  return (distribution[fascistCount] ?? 0) / arrangements;
}

/**
 * The chance the very next card is Fascist — what the election tracker reveals on a third failed
 * election. By symmetry this is just the expected Fascist count over the pile size.
 */
export function getTopCardFascistProbability(deck: DeckState): number {
  return deck.size === 0 ? 0 : expectedFascistCount(deck) / deck.size;
}

/**
 * Whether any composition of the pile is still consistent with the record.
 *
 * A session that no world survives returns an empty distribution, and every number taken from it
 * afterwards is arithmetic over nothing — a draw distribution of all zeros, which reads as "a
 * Fascist law is certain" if it is printed rather than checked.
 */
export function isDeckPossible(deck: DeckState): boolean {
  return deck.fascistCountProbabilities.some((probability) => probability > 0);
}

/**
 * Remove the top card after it has been revealed, as the election tracker does on a third failed
 * election.
 *
 * The revealed colour is evidence about the pile itself — a Fascist card off the top is likelier
 * from a Fascist-heavy pile — so the distribution is updated by Bayes before the card is removed,
 * rather than merely decremented.
 */
export function removeRevealedTopCard(deck: DeckState, policy: Policy): DeckState {
  if (deck.size === 0) {
    throw new RangeError('Cannot reveal the top card of an empty pile.');
  }

  const weights: number[] = [];

  for (const [fascistCount, probability] of deck.fascistCountProbabilities.entries()) {
    if (probability === 0) {
      continue;
    }

    const matchingCards = policy === Policy.Fascist ? fascistCount : deck.size - fascistCount;
    const remainingFascistCount = policy === Policy.Fascist ? fascistCount - 1 : fascistCount;

    if (matchingCards === 0) {
      continue;
    }

    weights[remainingFascistCount] = (weights[remainingFascistCount] ?? 0) + probability * matchingCards / deck.size;
  }

  return {
    fascistCountProbabilities: normalise(weights),
    size: deck.size - 1
  };
}

/**
 * Rebuild the pile from the discard pile, which is what happens when fewer than three cards remain
 * at the end of a legislative session.
 *
 * Leftovers are shuffled back in rather than discarded, so every card that has not been *enacted*
 * returns. The pile is therefore exactly the full deck minus the face-up tracks, and the
 * distribution collapses to a point mass — the one moment the composition is known for certain.
 */
export function reshuffle(enactedFascistCount: number, enactedLiberalCount: number): DeckState {
  return createKnownDeck(
    FASCIST_POLICY_COUNT - enactedFascistCount,
    TOTAL_POLICY_COUNT - enactedFascistCount - enactedLiberalCount
  );
}

function normalise(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + (weight || 0), 0);

  if (total === 0) {
    throw new RangeError('Cannot normalise a distribution with no surviving outcomes.');
  }

  return Array.from({ length: weights.length }, (_unused, index) => (weights[index] ?? 0) / total);
}
