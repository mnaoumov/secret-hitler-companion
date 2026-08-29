import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  DiscardModel,
  SessionAnalysis
} from './session.ts';

import {
  createFullDeck,
  createKnownDeck,
  getExactFascistCount
} from './deck.ts';
import { Policy } from './policy.ts';
import { analyseSession } from './session.ts';

/*
 * Government 1 of the owner's original sketch:
 *
 *   Players: Alpha Bravo Charlie Delta Echo
 *   Government 1: President Alpha, Chancellor Bravo — elected
 *   Law result: F
 *   Chancellor claim: FF    President claim: FFF
 *
 * Every expected value below was computed by hand from the 11F/6L deck before any code existed.
 */
describe('government 1 of the owner\'s example', () => {
  function analyse(discardModel: DiscardModel): SessionAnalysis {
    return analyseSession({ deck: createFullDeck(), discardModel, enacted: Policy.Fascist });
  }

  it('rules out LLL, because an enacted F proves a Fascist was drawn', () => {
    expect(analyse('shuffle').drawProbabilities[0]).toBe(0);
    expect(analyse('uniform').drawProbabilities[0]).toBe(0);
  });

  it('gives 25 / 50 / 25 under the shuffle model', () => {
    const { drawProbabilities } = analyse('shuffle');

    expect(drawProbabilities[3]).toBeCloseTo(165 / 660, 12);
    expect(drawProbabilities[2]).toBeCloseTo(330 / 660, 12);
    expect(drawProbabilities[1]).toBeCloseTo(165 / 660, 12);
    expect(drawProbabilities[3]).toBeCloseTo(0.25, 12);
  });

  it('gives 37.5 / 50 / 12.5 under the uniform model', () => {
    const { drawProbabilities } = analyse('uniform');

    expect(drawProbabilities[3]).toBeCloseTo(165 / 440, 12);
    expect(drawProbabilities[2]).toBeCloseTo(220 / 440, 12);
    expect(drawProbabilities[1]).toBeCloseTo(55 / 440, 12);
    expect(drawProbabilities[3]).toBeCloseTo(0.375, 12);
  });

  /*
   * The heart of it. If the President really drew FFF he had only Fascist cards to discard, so the
   * Chancellor received FF necessarily — the owner's 100%, forced by "you cannot discard a card you
   * do not hold" and by nothing else. It must hold identically under both models, since no choice
   * exists to model.
   */
  it.each(['shuffle', 'uniform'] as const)(
    'forces the Chancellor to have held FF once the President is believed (%s)',
    (discardModel) => {
      const { passProbabilityBounds } = analyseSession({
        allowedDrawFascistCounts: [3],
        deck: createFullDeck(),
        discardModel,
        enacted: Policy.Fascist
      });

      expect(passProbabilityBounds[2]?.min).toBeCloseTo(1, 12);
      expect(passProbabilityBounds[2]?.max).toBeCloseTo(1, 12);
      expect(passProbabilityBounds[1]?.max).toBe(0);
      expect(passProbabilityBounds[0]?.max).toBe(0);
    }
  );

  it('leaves the pair unforced when the President is not believed', () => {
    const { passProbabilityBounds } = analyseSession({
      allowedDrawFascistCounts: [1, 2],
      deck: createFullDeck(),
      discardModel: 'shuffle',
      enacted: Policy.Fascist
    });

    // A drawn FFL is consistent with passing either FF or FL, so neither is forced.
    expect(passProbabilityBounds[2]?.min).toBe(0);
    expect(passProbabilityBounds[2]?.max).toBeGreaterThan(0);
  });
});

describe('deck handed to government 2', () => {
  it('is exactly 8F 6L when the President drew FFF', () => {
    const { deckAfter } = analyseSession({
      allowedDrawFascistCounts: [3],
      deck: createFullDeck(),
      discardModel: 'shuffle',
      enacted: Policy.Fascist
    });

    expect(deckAfter.size).toBe(14);
    expect(getExactFascistCount(deckAfter)).toBe(8);
  });

  it('splits 2/3 : 1/3 across 9F5L and 10F4L when he did not', () => {
    const { deckAfter } = analyseSession({
      allowedDrawFascistCounts: [1, 2],
      deck: createFullDeck(),
      discardModel: 'shuffle',
      enacted: Policy.Fascist
    });

    expect(deckAfter.size).toBe(14);
    expect(deckAfter.fascistCountProbabilities[9]).toBeCloseTo(2 / 3, 12);
    expect(deckAfter.fascistCountProbabilities[10]).toBeCloseTo(1 / 3, 12);
    expect(getExactFascistCount(deckAfter)).toBeNull();
  });

  /*
   * The dependency the owner's P(A2|A1) vs P(A2|A1') notation is about: the same claim from the
   * next President is 1.7x likelier if the first one lied, purely because the two branches leave
   * different decks behind.
   */
  it('makes an identical FFF claim 1.7x likelier if the first President lied', () => {
    function nextClaimProbability(allowedDrawFascistCounts: readonly number[]): number {
      const { deckAfter } = analyseSession({
        allowedDrawFascistCounts,
        deck: createFullDeck(),
        discardModel: 'shuffle',
        enacted: Policy.Fascist
      });

      return analyseSession({ deck: deckAfter, discardModel: 'shuffle', enacted: null })
        .drawProbabilities[3] ?? 0;
    }

    const ifTruthful = nextClaimProbability([3]);
    const ifLying = nextClaimProbability([1, 2]);

    expect(ifTruthful).toBeCloseTo(0.15385, 5);
    expect(ifLying).toBeCloseTo(0.26374, 5);
    expect(ifLying / ifTruthful).toBeCloseTo(1.714, 3);
  });
});

/*
 * The owner's own statement of the rule, pinned as a test:
 *
 *   "if we got F card on the table, we know for sure there were 4 options: FFF, FFL, FLL,
 *    (LLL is impossible). Similarly for L we could have FFL, FLL, LLL, (FFF is impossible)"
 *
 * Both directions follow from the same fact — nobody can enact a colour they were not holding — and
 * neither needs any assumption about who discarded what.
 */
describe('what the enacted policy rules out', () => {
  it('rules out LLL and nothing else when a Fascist policy goes up', () => {
    const { drawProbabilities } = analyseSession({
      deck: createFullDeck(),
      discardModel: 'shuffle',
      enacted: Policy.Fascist
    });

    expect(drawProbabilities[0]).toBe(0);
    expect(drawProbabilities[1]).toBeGreaterThan(0);
    expect(drawProbabilities[2]).toBeGreaterThan(0);
    expect(drawProbabilities[3]).toBeGreaterThan(0);
  });

  it('rules out FFF and nothing else when a Liberal policy goes up', () => {
    const { drawProbabilities } = analyseSession({
      deck: createFullDeck(),
      discardModel: 'shuffle',
      enacted: Policy.Liberal
    });

    expect(drawProbabilities[3]).toBe(0);
    expect(drawProbabilities[2]).toBeCloseTo(330 / 515, 12);
    expect(drawProbabilities[1]).toBeCloseTo(165 / 515, 12);
    expect(drawProbabilities[0]).toBeCloseTo(20 / 515, 12);
  });

  it('keeps every hand on the table when the government vetoes', () => {
    const { drawProbabilities } = analyseSession({
      deck: createFullDeck(),
      discardModel: 'shuffle',
      enacted: null
    });

    expect(drawProbabilities.every((probability) => probability > 0)).toBe(true);
  });
});

describe('impossible records', () => {
  it('reports a Fascist enactment from an all-Liberal pile as impossible', () => {
    const analysis = analyseSession({ deck: createKnownDeck(0, 6), discardModel: 'shuffle', enacted: Policy.Fascist });

    expect(analysis.isPossible).toBe(false);
  });

  it('reports a claim the pile cannot supply as impossible', () => {
    const analysis = analyseSession({
      allowedDrawFascistCounts: [3],
      deck: createKnownDeck(2, 10),
      discardModel: 'shuffle',
      enacted: Policy.Fascist
    });

    expect(analysis.isPossible).toBe(false);
  });
});

describe('veto', () => {
  it('consumes three cards without enacting anything', () => {
    const { deckAfter, drawProbabilities } = analyseSession({
      deck: createFullDeck(),
      discardModel: 'shuffle',
      enacted: null
    });

    expect(deckAfter.size).toBe(14);
    // With nothing enacted there is no evidence, so the draw keeps its unconditioned prior.
    expect(drawProbabilities[0]).toBeCloseTo(20 / 680, 12);
    expect(drawProbabilities[3]).toBeCloseTo(165 / 680, 12);
  });
});
