import {
  describe,
  expect,
  it
} from 'vitest';

import { getChancellorDiscard } from './claims.ts';
import { Policy } from './policy.ts';

describe('the Chancellor\'s discard', () => {
  /*
   * Never asked at the table, because it is already known: he holds two and plays one face up, so
   * the pair he claims minus the policy on the board names the card he threw away. Every one of the
   * four legal combinations is forced.
   */
  it('is forced by the claimed pair and the policy on the table', () => {
    expect(getChancellorDiscard(2, Policy.Fascist)).toBe(Policy.Fascist);
    expect(getChancellorDiscard(1, Policy.Fascist)).toBe(Policy.Liberal);
    expect(getChancellorDiscard(1, Policy.Liberal)).toBe(Policy.Fascist);
    expect(getChancellorDiscard(0, Policy.Liberal)).toBe(Policy.Liberal);
  });

  it('says nothing while either half is missing', () => {
    expect(getChancellorDiscard(undefined, Policy.Fascist)).toBeUndefined();
    expect(getChancellorDiscard(2, undefined)).toBeUndefined();
  });

  /*
   * A claim the board refutes implies nothing at all. Reporting a discard here would dress a lie up
   * as bookkeeping; `findLies` names the liar instead.
   */
  it('says nothing when his claim could not have produced the policy', () => {
    expect(getChancellorDiscard(0, Policy.Fascist)).toBeUndefined();
    expect(getChancellorDiscard(2, Policy.Liberal)).toBeUndefined();
  });
});
