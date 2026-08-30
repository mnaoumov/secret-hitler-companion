import {
  describe,
  expect,
  it
} from 'vitest';

import { createFullDeck } from './deck.ts';
import { Policy } from './policy.ts';
import {
  Allegiance,
  analyseGovernmentRoles
} from './roles.ts';

const FIVE_PLAYERS = 5;

function analyse(overrides: Partial<Parameters<typeof analyseGovernmentRoles>[0]>): Map<string, number> {
  const odds = analyseGovernmentRoles({
    chancellorClaim: undefined,
    deck: createFullDeck(),
    enacted: Policy.Fascist,
    playerCount: FIVE_PLAYERS,
    presidentClaim: undefined,
    presidentDiscard: undefined,
    ...overrides
  });

  return new Map(odds.map((entry) => [`${entry.president}-${entry.chancellor}`, entry.probability]));
}

function sumWhere(odds: Map<string, number>, prefix: string): number {
  return [...odds].filter(([key]) => key.startsWith(prefix)).reduce((sum, [, value]) => sum + value, 0);
}

describe('who was in the government', () => {
  it('always adds up to one', () => {
    const odds = analyse({});

    expect([...odds.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  });

  /*
   * A Liberal Chancellor holding LL enacts the Liberal, so a Fascist law with that claim puts him
   * out of the question — whatever the President is.
   */
  it('names the Chancellor a Fascist when his own claim rules out a Liberal', () => {
    const odds = analyse({ chancellorClaim: 0, enacted: Policy.Fascist });

    expect(
      sumWhere(odds, `${Allegiance.Fascist}-${Allegiance.Fascist}`)
        + sumWhere(odds, `${Allegiance.Liberal}-${Allegiance.Fascist}`)
    ).toBeCloseTo(1, 12);
  });

  /*
   * Passing FF while holding FFL settles the round against the Liberals, which no Liberal does. He
   * would have to have lied about the hand to escape it, and Liberals do not lie either.
   */
  it('names the President a Fascist when he says he handed over a forced Fascist pair', () => {
    const odds = analyse({
      enacted: Policy.Fascist,
      presidentClaim: 2,
      presidentDiscard: Policy.Liberal
    });

    expect(sumWhere(odds, `${Allegiance.Fascist}-`)).toBeCloseTo(1, 12);
  });

  /*
   * The point the owner made: passing FL from FLL is a way of finding out what the Chancellor does
   * with it, so it is not evidence against the President at all.
   */
  it('holds nothing against a President who passed FL from FLL', () => {
    const odds = analyse({
      chancellorClaim: 1,
      enacted: Policy.Liberal,
      presidentClaim: 1,
      presidentDiscard: Policy.Liberal
    });

    expect(sumWhere(odds, `${Allegiance.Liberal}-`)).toBeGreaterThan(0);
  });

  /*
   * With nobody saying anything, an enacted law rules almost nothing out: a Fascist pair is free to
   * enact a Liberal law, and often does. The answer is then close to the seating and says so.
   */
  it('barely moves off the seating when nothing has been claimed', () => {
    const odds = analyse({ enacted: Policy.Liberal });

    expect(odds.get(`${Allegiance.Fascist}-${Allegiance.Fascist}`)).toBeCloseTo(0.1, 2);
    expect(odds.get(`${Allegiance.Liberal}-${Allegiance.Liberal}`)).toBeCloseTo(0.3, 2);
  });

  /*
   * A Liberal pair cannot produce a Fascist law unless the draw left them no choice, so the record
   * leans away from them without ever ruling them out.
   */
  it('leans away from two Liberals when a Fascist law went up', () => {
    const liberalLaw = analyse({ enacted: Policy.Liberal });
    const fascistLaw = analyse({ enacted: Policy.Fascist });

    expect(fascistLaw.get(`${Allegiance.Liberal}-${Allegiance.Liberal}`) ?? 0)
      .toBeLessThan(liberalLaw.get(`${Allegiance.Liberal}-${Allegiance.Liberal}`) ?? 0);
  });
});
