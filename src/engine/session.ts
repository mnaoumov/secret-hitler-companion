import type { DeckState } from './deck.ts';

import { hypergeometricProbability } from './combinatorics.ts';
import {
  DRAW_SIZE,
  PASS_SIZE,
  Policy
} from './policy.ts';

export interface AnalyseSessionParams {
  /**
   * Restrict to worlds where the President really drew one of these Fascist counts.
   *
   * This is the mechanism behind pinning a claim: trusting it passes the single claimed count,
   * distrusting it passes every other count. Omit to leave the draw unconstrained.
   */
  readonly allowedDrawFascistCounts?: readonly number[] | undefined;

  /** The same constraint for the pair the Chancellor received. */
  readonly allowedPassFascistCounts?: readonly number[] | undefined;

  readonly deck: DeckState;
  readonly discardModel: DiscardModel;

  /** The policy placed face up, or `null` when the government vetoed and both were discarded. */
  readonly enacted: null | Policy;
}

/**
 * How to treat a choice the shuffle does not determine.
 *
 * The shuffle picks which three cards the President draws. It does not pick which one he discards,
 * nor which of the two the Chancellor enacts. Those are human decisions, so there are two honest
 * readings:
 *
 * - `shuffle` quantifies nothing but the shuffle. A world survives if *some* sequence of choices
 *   is consistent with the public record, and it carries its shuffle weight unmodified. This is
 *   assumption-free, and it is why a hand of FFF or LLL — where no choice exists — yields an exact
 *   answer.
 * - `uniform` treats every unforced choice as a coin flip. Every cell becomes a single number, at
 *   the cost of an assumption known to be false: nobody discards at random.
 */
export type DiscardModel = 'shuffle' | 'uniform';

/**
 * Under `shuffle`, hypotheses about the passed pair overlap — a drawn FFL is consistent with
 * passing either FF or FL — so they do not partition and cannot be a distribution. `min` is the
 * weight of worlds where the pair is *forced*, `max` the weight where it is merely *possible*.
 * Under `uniform` the two coincide.
 */
export interface ProbabilityBounds {
  readonly max: number;
  readonly min: number;
}

export interface SessionAnalysis {
  readonly deckAfter: DeckState;

  /** Index is the number of Fascist policies among the three the President drew. */
  readonly drawProbabilities: readonly number[];

  /** False when no world survives at all, i.e. the record contradicts itself. */
  readonly isPossible: boolean;

  /** Index is the number of Fascist policies among the two passed to the Chancellor. */
  readonly passProbabilityBounds: readonly ProbabilityBounds[];
}

interface PassOption {
  /** Probability the President discards this card when he chooses uniformly at random. */
  readonly discardProbability: number;
  readonly passFascistCount: number;
}

export function analyseSession(params: AnalyseSessionParams): SessionAnalysis {
  const { allowedDrawFascistCounts, allowedPassFascistCounts, deck, discardModel, enacted } = params;

  const drawWeights = new Array<number>(DRAW_SIZE + 1).fill(0);
  const passForcedWeights = new Array<number>(PASS_SIZE + 1).fill(0);
  const passPossibleWeights = new Array<number>(PASS_SIZE + 1).fill(0);
  const deckAfterWeights = new Array<number>(deck.fascistCountProbabilities.length).fill(0);
  let total = 0;

  for (const [pileFascistCount, pileProbability] of deck.fascistCountProbabilities.entries()) {
    if (pileProbability <= 0) {
      continue;
    }

    for (let drawFascistCount = 0; drawFascistCount <= DRAW_SIZE; drawFascistCount++) {
      if (allowedDrawFascistCounts && !allowedDrawFascistCounts.includes(drawFascistCount)) {
        continue;
      }

      const drawProbability = hypergeometricProbability({
        drawSize: DRAW_SIZE,
        fascistInDraw: drawFascistCount,
        fascistInPile: pileFascistCount,
        pileSize: deck.size
      });

      if (drawProbability <= 0) {
        continue;
      }

      const base = pileProbability * drawProbability;
      const consistent = getPassOptions(drawFascistCount)
        .filter((option) => !allowedPassFascistCounts || allowedPassFascistCounts.includes(option.passFascistCount))
        .filter((option) => isEnactmentPossible(option.passFascistCount, enacted));

      if (consistent.length === 0) {
        continue;
      }

      let drawWeight = 0;

      if (discardModel === 'uniform') {
        for (const option of consistent) {
          const weight = base * option.discardProbability * getEnactmentProbability(option.passFascistCount, enacted);
          drawWeight += weight;
          addAt(passForcedWeights, option.passFascistCount, weight);
          addAt(passPossibleWeights, option.passFascistCount, weight);
        }
      } else {
        drawWeight = base;

        for (const option of consistent) {
          addAt(passPossibleWeights, option.passFascistCount, base);
        }

        const onlyOption = consistent.length === 1 ? consistent[0] : undefined;

        if (onlyOption) {
          addAt(passForcedWeights, onlyOption.passFascistCount, base);
        }
      }

      if (drawWeight <= 0) {
        continue;
      }

      addAt(drawWeights, drawFascistCount, drawWeight);
      addAt(deckAfterWeights, pileFascistCount - drawFascistCount, drawWeight);
      total += drawWeight;
    }
  }

  if (total === 0) {
    return {
      deckAfter: { fascistCountProbabilities: [], size: Math.max(0, deck.size - DRAW_SIZE) },
      drawProbabilities: new Array<number>(DRAW_SIZE + 1).fill(0),
      isPossible: false,
      passProbabilityBounds: new Array<number>(PASS_SIZE + 1).fill(0).map(() => ({ max: 0, min: 0 }))
    };
  }

  return {
    deckAfter: {
      fascistCountProbabilities: deckAfterWeights.map((weight) => weight / total),
      size: deck.size - DRAW_SIZE
    },
    drawProbabilities: drawWeights.map((weight) => weight / total),
    isPossible: true,
    passProbabilityBounds: passPossibleWeights.map((possible, passFascistCount) => ({
      max: possible / total,
      min: (passForcedWeights[passFascistCount] ?? 0) / total
    }))
  };
}

/** `noUncheckedIndexedAccess` makes a bare `array[index] += value` unsound, so accumulate here. */
function addAt(target: number[], index: number, value: number): void {
  target[index] = (target[index] ?? 0) + value;
}

function getEnactmentProbability(passFascistCount: number, enacted: null | Policy): number {
  if (enacted === null) {
    return 1;
  }

  return enacted === Policy.Fascist ? passFascistCount / PASS_SIZE : (PASS_SIZE - passFascistCount) / PASS_SIZE;
}

/** The pair the Chancellor receives, once the President has discarded one of his three. */
function getPassOptions(drawFascistCount: number): PassOption[] {
  const options: PassOption[] = [];
  const liberalInDraw = DRAW_SIZE - drawFascistCount;

  if (drawFascistCount > 0) {
    options.push({ discardProbability: drawFascistCount / DRAW_SIZE, passFascistCount: drawFascistCount - 1 });
  }

  if (liberalInDraw > 0) {
    options.push({ discardProbability: liberalInDraw / DRAW_SIZE, passFascistCount: drawFascistCount });
  }

  return options;
}

function isEnactmentPossible(passFascistCount: number, enacted: null | Policy): boolean {
  if (enacted === null) {
    return true;
  }

  return enacted === Policy.Fascist ? passFascistCount > 0 : passFascistCount < PASS_SIZE;
}
