import {
  describe,
  expect,
  it
} from 'vitest';

import { combinations } from './combinatorics.ts';
import {
  createFullDeck,
  createKnownDeck,
  expectedFascistCount,
  getDrawDistribution,
  getExactFascistCount,
  getOrderedDrawProbability,
  getTopCardFascistProbability,
  removeRevealedTopCard,
  reshuffle
} from './deck.ts';
import {
  DRAW_SIZE,
  Policy
} from './policy.ts';
import { analyseSession } from './session.ts';
import { SPREADSHEET_ROWS } from './spreadsheet-fixture.ts';

describe('createFullDeck', () => {
  it('is 11F 6L and known exactly', () => {
    const deck = createFullDeck();

    expect(deck.size).toBe(17);
    expect(getExactFascistCount(deck)).toBe(11);
  });
});

/*
 * This is the owner's spreadsheet, automated. His sheet made him type in F and L by hand; the app
 * derives them. The numbers themselves must be identical, so every row of it is asserted here.
 */
describe('getDrawDistribution', () => {
  it('reproduces the spreadsheet row for the opening deck', () => {
    const distribution = getDrawDistribution(createFullDeck());

    expect(distribution[3]).toBeCloseTo(0.2426470588235294, 12);
    expect(distribution[2]).toBeCloseTo(0.4852941176470589, 12);
    expect(distribution[1]).toBeCloseTo(0.24264705882352944, 12);
    expect(distribution[0]).toBeCloseTo(0.029411764705882356, 12);
  });

  it.each(SPREADSHEET_ROWS)('matches the spreadsheet for $fascist F / $liberal L', (row) => {
    const deck = createKnownDeck(row.fascist, row.fascist + row.liberal);
    const distribution = getDrawDistribution(deck);

    expect(distribution[3]).toBeCloseTo(row.threeFascist, 12);
    expect(distribution[2]).toBeCloseTo(row.twoFascistOneLiberal, 12);
    expect(distribution[1]).toBeCloseTo(row.oneFascistTwoLiberal, 12);
    expect(distribution[0]).toBeCloseTo(row.threeLiberal, 12);

    // The sheet's "draw at least 1 Liberal" and "Fascist off the top" columns.
    expect(1 - (distribution[3] ?? 0)).toBeCloseTo(row.atLeastOneLiberal, 12);
    expect(getTopCardFascistProbability(deck)).toBeCloseTo(row.fascistOffTop, 12);
  });

  /*
   * Once the pile is uncertain the draw odds are the average over every composition it might have,
   * which is the thing the spreadsheet could not do — it only ever knew one row at a time.
   */
  it('averages over an uncertain pile', () => {
    const uncertain = {
      fascistCountProbabilities: [0, 0, 0, 0, 0, 0.5, 0.5],
      size: 10
    };

    const distribution = getDrawDistribution(uncertain);
    const fiveFascists = getDrawDistribution(createKnownDeck(5, 10));
    const sixFascists = getDrawDistribution(createKnownDeck(6, 10));

    expect(distribution[3]).toBeCloseTo(((fiveFascists[3] ?? 0) + (sixFascists[3] ?? 0)) / 2, 12);
    expect(distribution.reduce((total, value) => total + value, 0)).toBeCloseTo(1, 12);
  });
});

describe('removeRevealedTopCard', () => {
  it('decrements a known pile', () => {
    const deck = removeRevealedTopCard(createKnownDeck(8, 12), Policy.Fascist);

    expect(deck.size).toBe(11);
    expect(getExactFascistCount(deck)).toBe(7);
  });

  /*
   * The revealed colour is evidence about the pile it came from, not just a card to subtract: a
   * Fascist off the top is likelier to have come from a Fascist-heavy pile, so the remaining
   * distribution must shift towards Fascist even after the card itself is removed.
   */
  it('shifts the distribution towards the revealed colour', () => {
    const uncertain = {
      fascistCountProbabilities: [0, 0, 0, 0, 0, 0.5, 0.5],
      size: 10
    };

    const afterFascist = removeRevealedTopCard(uncertain, Policy.Fascist);
    const afterLiberal = removeRevealedTopCard(uncertain, Policy.Liberal);

    // Before: 5 or 6 Fascists, equally likely, so 5.5 expected among 10.
    expect(expectedFascistCount(uncertain)).toBeCloseTo(5.5, 12);

    /*
     * Likelihoods 5/10 and 6/10 against equal priors give P(6 Fascists | top was F) = 30/55 = 6/11.
     * Removing that Fascist leaves 5, so 6/11 lands on index 5 and the 5-Fascist branch on index 4.
     */
    expect(afterFascist.fascistCountProbabilities[5]).toBeCloseTo(6 / 11, 12);
    expect(afterFascist.fascistCountProbabilities[4]).toBeCloseTo(5 / 11, 12);

    // A Liberal off the top pushes the other way, and removing it leaves the Fascist count alone.
    expect(afterLiberal.fascistCountProbabilities[5]).toBeCloseTo(5 / 9, 12);
    expect(afterLiberal.fascistCountProbabilities[6]).toBeCloseTo(4 / 9, 12);
  });

  it('refuses a colour the pile cannot hold', () => {
    expect(() => removeRevealedTopCard(createKnownDeck(0, 4), Policy.Fascist)).toThrow();
  });
});

describe('reshuffle', () => {
  it('is exactly the full deck minus the face-up tracks', () => {
    const deck = reshuffle(3, 2);

    expect(deck.size).toBe(12);
    expect(getExactFascistCount(deck)).toBe(8);
  });

  /*
   * Leftovers are shuffled back in rather than discarded, so every card that was not enacted
   * returns. That is what makes the reshuffle collapse all accumulated uncertainty — the one moment
   * in a shuffle cycle when the pile is known for certain.
   */
  it('collapses uncertainty accumulated across a cycle', () => {
    let deck = createFullDeck();
    let enactedFascistCount = 0;

    for (let session = 0; session < 4; session++) {
      deck = analyseSession({ deck, discardModel: 'shuffle', enacted: Policy.Fascist }).deckAfter;
      enactedFascistCount++;
    }

    expect(deck.size).toBe(5);
    expect(getExactFascistCount(deck)).toBeNull();

    const rebuilt = reshuffle(enactedFascistCount, 0);

    expect(rebuilt.size).toBe(13);
    expect(getExactFascistCount(rebuilt)).toBe(7);
  });
});

describe('an ordered peek at the top three', () => {
  /*
   * A Policy Peek is an ordered look, so reporting "Fascist, Fascist, Liberal" is a stronger claim
   * than reporting "two Fascists and a Liberal": three arrangements give that hand and only one of
   * them is his.
   */
  it('is the hand distribution split across the arrangements that give that hand', () => {
    const deck = createFullDeck();
    const distribution = getDrawDistribution(deck);

    expect(getOrderedDrawProbability(deck, 2)).toBeCloseTo((distribution[2] ?? 0) / 3, 12);
    expect(getOrderedDrawProbability(deck, 1)).toBeCloseTo((distribution[1] ?? 0) / 3, 12);
  });

  it('leaves a hand with one arrangement untouched', () => {
    const deck = createFullDeck();

    // FFF and LLL can each be dealt one way, so ordering costs them nothing.
    expect(getOrderedDrawProbability(deck, 3)).toBeCloseTo(165 / 680, 12);
    expect(getOrderedDrawProbability(deck, 0)).toBeCloseTo(20 / 680, 12);
  });

  it('sums to one over every sequence the deck can produce', () => {
    const deck = createKnownDeck(5, 9);
    const total = [0, 1, 2, 3].reduce(
      (sum, fascistCount) => sum + getOrderedDrawProbability(deck, fascistCount) * combinations(DRAW_SIZE, fascistCount),
      0
    );

    expect(total).toBeCloseTo(1, 12);
  });
});
