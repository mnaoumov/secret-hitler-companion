import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  Game,
  Round
} from './game.ts';

import { getExactFascistCount } from './deck.ts';
import { analyseGame } from './game.ts';
import { Policy } from './policy.ts';

const PLAYERS = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((id) => ({ id, name: id }));

function buildGame(rounds: readonly Round[]): Game {
  return { players: PLAYERS, rounds };
}

const OWNERS_FIRST_GOVERNMENT: Round = {
  chancellorClaim: 2,
  chancellorId: 'bravo',
  enacted: Policy.Fascist,
  presidentClaim: 3,
  presidentId: 'alpha',
  votes: { alpha: true, bravo: true, charlie: false, delta: true, echo: true },
  wasElected: true
};

describe('the owner\'s example as a game', () => {
  const analysis = analyseGame(buildGame([OWNERS_FIRST_GOVERNMENT]));
  const round = analysis.rounds[0];

  it('scores the President against the shuffle and the uniform model', () => {
    expect(round?.shuffle.presidentClaim?.bounds.min).toBeCloseTo(0.25, 12);
    expect(round?.uniform.presidentClaim?.bounds.min).toBeCloseTo(0.375, 12);
    expect(round?.shuffle.presidentClaim?.verdict).toBe('possible');
  });

  it('does not call the Chancellor forced while the President is unpinned', () => {
    expect(round?.shuffle.chancellorClaim?.verdict).toBe('possible');
  });

  it('finds nothing to accuse anyone of', () => {
    expect(round?.lies).toEqual([]);
  });

  it('forces the Chancellor once the President is believed', () => {
    const pinned = analyseGame(buildGame([{ ...OWNERS_FIRST_GOVERNMENT, assumedDrawFascistCounts: [3] }]));

    expect(pinned.rounds[0]?.shuffle.chancellorClaim?.verdict).toBe('forced');
    expect(pinned.rounds[0]?.shuffle.chancellorClaim?.bounds.min).toBeCloseTo(1, 12);
    expect(getExactFascistCount(pinned.rounds[0]?.deckAfter ?? { fascistCountProbabilities: [], size: 0 })).toBe(8);
  });

  it('tracks the enacted policy', () => {
    expect(analysis.enactedFascistCount).toBe(1);
    expect(analysis.enactedLiberalCount).toBe(0);
  });
});

describe('contradictions', () => {
  /*
   * Reported by the owner: with a Fascist policy on the table, a Chancellor claiming LL is not a
   * "one of these two" situation. The enacted policy is a public fact, and no pair of Liberals can
   * produce it, so he is provably the liar — and the President is not implicated at all.
   */
  it('names the Chancellor when the enacted policy refutes his own claim', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 0,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 3,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.lies.map((lie) => lie.actor)).toEqual(['chancellor']);
  });

  it('names the President when his own claim could not have produced the policy', () => {
    // He says he drew LLL, so he passed LL — no Fascist could have come from that government.
    const analysis = analyseGame(buildGame([{
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 0,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.lies.map((lie) => lie.actor)).toEqual(['president']);
  });

  it('names both when the enacted policy refutes each of them separately', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 0,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 0,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.lies.map((lie) => lie.actor)).toEqual(['chancellor', 'president']);
  });

  /*
   * Only when neither claim is refuted on its own does the weaker finding apply — and then it is
   * genuinely all that can be said.
   */
  it('falls back to "one of them" when both claims are individually possible', () => {
    // He says he passed FF; the Chancellor says he received FL. Both could have produced the F.
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 1,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 3,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.lies.map((lie) => lie.actor)).toEqual(['unknown']);
  });

  it('does not add the vaguer finding once a liar is named', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 0,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 3,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.lies).toHaveLength(1);
  });

  /*
   * Reported by the owner: "it's possible if President for whatever reason discarded L card and
   * then confessed about it". Exactly so — a President who drew FFL and discarded the Liberal passes
   * FF, and admitting the Liberal is unusual but not impossible. The only thing that would rule it
   * out is a Liberal on the table, which a Chancellor holding FF could not have produced.
   */
  it('accepts FFL then FF when a Fascist policy went up', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 2,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 2,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.lies).toEqual([]);
    expect(analysis.rounds[0]?.shuffle.chancellorClaim?.verdict).toBe('possible');
  });

  it('rejects FFL then FF when a Liberal policy went up', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 2,
      chancellorId: 'bravo',
      enacted: Policy.Liberal,
      presidentClaim: 2,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.shuffle.chancellorClaim?.verdict).toBe('impossible');
  });

  it('accepts a pair differing by the one discarded card', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 1,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 2,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.lies).toEqual([]);
  });

  /*
   * A Policy Peek returns the cards in order, so the next President draws exactly what was peeked.
   * Reporting FFL and then hearing FFF from the next seat is a provable lie by one of them.
   */
  it('catches a peek the next draw contradicts', () => {
    const analysis = analyseGame(buildGame([
      { enacted: Policy.Fascist, peek: [Policy.Fascist, Policy.Fascist, Policy.Liberal], presidentId: 'alpha', wasElected: true },
      { enacted: Policy.Fascist, presidentClaim: 3, presidentId: 'bravo', wasElected: true }
    ]));

    expect(analysis.rounds[0]?.peekContradiction).toBe(true);
  });

  it('accepts a peek the next draw matches', () => {
    const analysis = analyseGame(buildGame([
      { enacted: Policy.Fascist, peek: [Policy.Fascist, Policy.Fascist, Policy.Liberal], presidentId: 'alpha', wasElected: true },
      { enacted: Policy.Fascist, presidentClaim: 2, presidentId: 'bravo', wasElected: true }
    ]));

    expect(analysis.rounds[0]?.peekContradiction).toBe(false);
  });
});

/*
 * Legal but odd. These are not accusations and carry no probability — they say only that, taking
 * the claims at face value, someone had a Liberal option and took the Fascist one. A table wants
 * that pointed out; it does not want it scored.
 */
describe('weird plays', () => {
  it('flags a President who says he binned a Liberal while holding a Fascist', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 2,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 2,
      presidentDiscard: Policy.Liberal,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.unusualPlays.map((play) => play.actor)).toEqual(['president']);
    expect(analysis.rounds[0]?.unusualPlays[0]?.description).toContain('says he discarded a Liberal');
    // The oddity is the confession: the covering lie was available and he did not use it.
    expect(analysis.rounds[0]?.unusualPlays[0]?.description).toContain('would have claimed FFF');
  });

  /*
   * Reported by the owner. FFL then FF used to be flagged against the President on the strength of
   * the CHANCELLOR's claim, which is not his statement to make: the same board is equally consistent
   * with the President having passed FL and the Chancellor having invented the second Fascist. The
   * flag now waits until the President has said what he binned.
   */
  it('says nothing about the President until he says what he binned', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 2,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 2,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.unusualPlays).toEqual([]);
  });

  it('flags a Chancellor who enacted a Fascist while holding a Liberal', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 1,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 2,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.unusualPlays.map((play) => play.actor)).toEqual(['chancellor']);
  });

  it('flags both seats when both took the Fascist option', () => {
    // Drew FLL, binned a Liberal to pass FL, then the Chancellor put the Fascist up.
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 1,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 1,
      presidentDiscard: Policy.Liberal,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.unusualPlays.map((play) => play.actor)).toEqual(['president', 'chancellor']);
  });

  it('says nothing when the play was forced', () => {
    // FFF leaves no Liberal to discard and FF leaves no Liberal to enact. Nothing was chosen.
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 2,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 3,
      presidentDiscard: Policy.Fascist,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.unusualPlays).toEqual([]);
  });

  /*
   * Discarding the Liberal is the odd choice whatever the Chancellor then does with the pair, so the
   * President keeps his flag — and the Chancellor, who put the Liberal up, earns none.
   */
  it('flags only the President when the Chancellor enacted the Liberal', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 1,
      chancellorId: 'bravo',
      enacted: Policy.Liberal,
      presidentClaim: 1,
      presidentDiscard: Policy.Liberal,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.unusualPlays.map((play) => play.actor)).toEqual(['president']);
  });
});

/*
 * The table asks the President both halves — what he drew and what he binned — so his account names
 * the pair he handed over. That is what makes the Chancellor answerable: the two men are describing
 * the same two cards, and a disagreement is theirs rather than an artefact of inferring one account
 * from the other.
 */
describe('what the President says he binned', () => {
  it('catches a Chancellor who invents the pair he was handed', () => {
    // He says he binned a Fascist, so he passed FL. The Chancellor says he was handed FF.
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 2,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 2,
      presidentDiscard: Policy.Fascist,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.lies.map((lie) => lie.actor)).toEqual(['unknown']);
    // And the President is no longer quietly blamed for a choice he says he did not make.
    expect(analysis.rounds[0]?.unusualPlays).toEqual([]);
  });

  it('agrees with the Chancellor when the two accounts line up', () => {
    const analysis = analyseGame(buildGame([{
      chancellorClaim: 1,
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentClaim: 2,
      presidentDiscard: Policy.Fascist,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.lies).toEqual([]);
  });

  /*
   * Sharper than testing the hand alone, which only ever fails for FFF and LLL: FFL could have
   * produced a Liberal, but FFL minus the Liberal could not.
   */
  it('names the President when the pair he says he passed could not have produced the policy', () => {
    const analysis = analyseGame(buildGame([{
      chancellorId: 'bravo',
      enacted: Policy.Liberal,
      presidentClaim: 2,
      presidentDiscard: Policy.Liberal,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.rounds[0]?.lies.map((lie) => lie.actor)).toEqual(['president']);
  });
});

describe('the veto', () => {
  const REJECTED: Round = { chancellorId: 'bravo', presidentId: 'alpha', wasElected: false };
  const VETOED: Round = { chancellorId: 'bravo', isVetoed: true, presidentId: 'alpha', wasElected: true };

  it('bins all three cards and enacts nothing', () => {
    const analysis = analyseGame(buildGame([VETOED]));

    expect(analysis.deckAfter.size).toBe(14);
    expect(analysis.enactedFascistCount).toBe(0);
    expect(analysis.enactedLiberalCount).toBe(0);
  });

  /*
   * The rulebook resets the tracker when a Policy is played face up, and a veto plays none. So an
   * elected government that vetoes still counts as inactive and the count carries forward.
   */
  it('advances the tracker rather than resetting it', () => {
    const analysis = analyseGame(buildGame([REJECTED, VETOED]));

    expect(analysis.rounds[1]?.electionTracker).toBe(2);
  });

  it('resets the tracker when the government enacts something instead', () => {
    const analysis = analyseGame(buildGame([
      REJECTED,
      { chancellorId: 'bravo', enacted: Policy.Fascist, presidentId: 'alpha', wasElected: true }
    ]));

    expect(analysis.rounds[1]?.electionTracker).toBe(0);
  });

  it('can be the third inactive government and throw the country into chaos', () => {
    const analysis = analyseGame(buildGame([
      REJECTED,
      REJECTED,
      { ...VETOED, forcedEnactment: Policy.Fascist }
    ]));

    expect(analysis.rounds[2]?.electionTracker).toBe(0);
    expect(analysis.enactedFascistCount).toBe(1);
    // Three binned by the veto, then the one the populace turned over.
    expect(analysis.deckAfter.size).toBe(13);
  });

  it('frees the term limits when it throws the country into chaos', () => {
    const analysis = analyseGame(buildGame([
      REJECTED,
      REJECTED,
      { ...VETOED, forcedEnactment: Policy.Fascist }
    ]));

    expect(analysis.termLimitedPlayerIds).toEqual([]);
  });
});

describe('the Hitler zone', () => {
  const threeFascistPolicies: Round[] = Array.from({ length: 3 }, () => ({
    chancellorId: 'bravo',
    enacted: Policy.Fascist,
    presidentId: 'alpha',
    wasElected: true
  }));

  /*
   * Surviving the check is the only thing in Secret Hitler that is true by rule rather than by
   * testimony: the rulebook forces Hitler to reveal himself if elected Chancellor after the third
   * Fascist policy. So a `no` is proof, and the label is permanent.
   */
  it('permanently clears a Chancellor who survives the check', () => {
    const analysis = analyseGame(buildGame([
      ...threeFascistPolicies,
      { chancellorId: 'charlie', enacted: Policy.Liberal, hitlerCheckAnswer: 'no', presidentId: 'delta', wasElected: true }
    ]));

    expect(analysis.confirmedNotHitler).toEqual(['charlie']);
    expect(analysis.isFascistVictoryByHitler).toBe(false);
  });

  it('ends the game when the Chancellor is Hitler', () => {
    const analysis = analyseGame(buildGame([
      ...threeFascistPolicies,
      { chancellorId: 'charlie', hitlerCheckAnswer: 'yes', presidentId: 'delta', wasElected: true }
    ]));

    expect(analysis.isFascistVictoryByHitler).toBe(true);
  });

  it('proves nothing before the third Fascist policy, when the question is not even asked', () => {
    const analysis = analyseGame(buildGame([
      { chancellorId: 'charlie', enacted: Policy.Fascist, hitlerCheckAnswer: 'no', presidentId: 'delta', wasElected: true }
    ]));

    expect(analysis.confirmedNotHitler).toEqual([]);
  });
});

describe('powers', () => {
  it('grants Policy Peek on the third Fascist policy at five players', () => {
    const analysis = analyseGame(buildGame(Array.from({ length: 3 }, () => ({
      enacted: Policy.Fascist,
      wasElected: true
    }))));

    expect(analysis.rounds.map((round) => round.power)).toEqual([null, null, 'policyPeek']);
  });
});

/*
 * The owner: "after reshuffling, we start over with collecting draws". Exactly — the pile is rebuilt
 * from the discard pile, so nothing claimed before the reshuffle can move a number after it. The
 * strip of assumptions therefore starts over too.
 */
describe('shuffle cycles', () => {
  it('starts at round 0 before any reshuffle', () => {
    const analysis = analyseGame(buildGame([
      { enacted: Policy.Fascist, wasElected: true },
      { enacted: Policy.Fascist, wasElected: true }
    ]));

    expect(analysis.currentCycleStartIndex).toBe(0);
  });

  it('moves to the round after the reshuffle', () => {
    // Four sessions take 12 of 17 cards, leaving 5; the fifth drops below three and rebuilds.
    const analysis = analyseGame(buildGame(
      Array.from({ length: 6 }, () => ({ enacted: Policy.Fascist, wasElected: true }))
    ));

    const reshuffleIndex = analysis.rounds.findIndex((round) => round.didReshuffle);

    expect(reshuffleIndex).toBeGreaterThan(-1);
    expect(analysis.currentCycleStartIndex).toBe(reshuffleIndex + 1);
  });

  /*
   * The point of the rule, stated as a property: an assumption made before the reshuffle leaves the
   * deck after it completely untouched.
   */
  it('makes pre-reshuffle assumptions irrelevant to the deck afterwards', () => {
    const rounds: Round[] = Array.from({ length: 6 }, () => ({
      enacted: Policy.Fascist,
      presidentClaim: 3,
      wasElected: true
    }));

    const withoutAssumption = analyseGame(buildGame(rounds));
    const assumed = rounds.map((round, index) => index === 0 ? { ...round, assumedDrawFascistCounts: [3] } : round);
    const withAssumption = analyseGame(buildGame(assumed));

    const cycleStart = withoutAssumption.currentCycleStartIndex;

    expect(withAssumption.currentCycleStartIndex).toBe(cycleStart);
    expect(withAssumption.rounds[cycleStart]?.deckBefore)
      .toEqual(withoutAssumption.rounds[cycleStart]?.deckBefore);
  });
});

describe('the election tracker', () => {
  it('enacts off the top after three failed elections and resets', () => {
    const analysis = analyseGame(buildGame([
      { wasElected: false },
      { wasElected: false },
      { forcedEnactment: Policy.Fascist, wasElected: false }
    ]));

    expect(analysis.enactedFascistCount).toBe(1);
    expect(analysis.rounds[2]?.electionTracker).toBe(0);
    // A failed election costs nothing; only the populace enactment removes a card.
    expect(analysis.rounds[2]?.deckAfter.size).toBe(16);
    expect(getExactFascistCount(analysis.rounds[2]?.deckAfter ?? { fascistCountProbabilities: [], size: 0 })).toBe(10);
  });
});

/*
 * The rulebook: "Players who enacted the last policy are not eligible to be Chancellor Candidate.
 * [NB: In a five-player game, only the last active Chancellor is ineligible; the last President may
 * be nominated. In all other games, neither the last President nor the last Chancellor may be
 * nominated.]"
 */
describe('term limits', () => {
  it('locks only the last Chancellor at five players', () => {
    const analysis = analyseGame(buildGame([{
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentId: 'alpha',
      wasElected: true
    }]));

    expect(analysis.termLimitedPlayerIds).toEqual(['bravo']);
  });

  it('locks both seats above five players', () => {
    const analysis = analyseGame({
      players: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'].map((id) => ({ id, name: id })),
      rounds: [{ chancellorId: 'bravo', enacted: Policy.Fascist, presidentId: 'alpha', wasElected: true }]
    });

    expect([...analysis.termLimitedPlayerIds].sort()).toEqual(['alpha', 'bravo']);
  });

  it('follows the last government that actually formed, not the last round', () => {
    const analysis = analyseGame(buildGame([
      { chancellorId: 'bravo', enacted: Policy.Fascist, presidentId: 'alpha', wasElected: true },
      { wasElected: false }
    ]));

    expect(analysis.termLimitedPlayerIds).toEqual(['bravo']);
  });

  /*
   * "Any power granted by this policy is ignored, but all players become eligible to hold the
   * office of Chancellor for the next Election."
   */
  it('frees everyone after the populace enacts a policy itself', () => {
    const analysis = analyseGame(buildGame([
      { chancellorId: 'bravo', enacted: Policy.Fascist, presidentId: 'alpha', wasElected: true },
      { wasElected: false },
      { wasElected: false },
      { forcedEnactment: Policy.Fascist, wasElected: false }
    ]));

    expect(analysis.termLimitedPlayerIds).toEqual([]);
  });

  it('relaxes to the five-player rule once executions leave five alive', () => {
    const analysis = analyseGame({
      players: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'].map((id) => ({ id, name: id })),
      rounds: [
        { enacted: Policy.Fascist, executionTargetId: 'foxtrot', presidentId: 'alpha', wasElected: true },
        { chancellorId: 'bravo', enacted: Policy.Fascist, executionTargetId: 'golf', presidentId: 'alpha', wasElected: true }
      ]
    });

    expect(analysis.termLimitedPlayerIds).toEqual(['bravo']);
  });
});

/*
 * The placard moves one seat clockwise every round — after a rejected election too, and even if the
 * next player was just in government.
 */
/*
 * The owner's point: a government of two Fascists survives scrutiny. `FLL -> FL -> F` really
 * happened, but they will not claim that — it leaves two weird flags. They claim `FFF / FF`, which
 * is perfectly innocent: no Liberal to discard, no Liberal to enact, nothing chosen. From public
 * information the round IS innocent, and no amount of analysis changes that.
 *
 * What they cannot fake is the pile. Every FFF claim takes three Fascists out of it, so the story
 * that costs nothing once becomes arithmetically impossible if repeated — and a shuffle cycle is
 * long enough to get there. This is what the deck tracking is for.
 */
describe('a Fascist government hiding behind FFF', () => {
  const innocentGovernment: Round = {
    assumedDrawFascistCounts: [3],
    chancellorClaim: 2,
    chancellorId: 'bravo',
    enacted: Policy.Fascist,
    presidentClaim: 3,
    presidentId: 'alpha',
    wasElected: true
  };

  it('is entirely clean the first time', () => {
    const round = analyseGame(buildGame([innocentGovernment])).rounds[0];

    expect(round?.lies).toEqual([]);
    expect(round?.unusualPlays).toEqual([]);
    expect(round?.shuffle.chancellorClaim?.verdict).toBe('forced');
    expect(round?.shuffle.isPossible).toBe(true);
  });

  it('drains the tracked pile by three Fascists each time', () => {
    const analysis = analyseGame(buildGame([innocentGovernment, innocentGovernment, innocentGovernment]));

    expect(analysis.rounds.map((round) => getExactFascistCount(round.deckAfter))).toEqual([8, 5, 2]);
  });

  it('becomes provably impossible on the fourth telling', () => {
    const analysis = analyseGame(buildGame(Array.from({ length: 4 }, () => innocentGovernment)));

    expect(analysis.rounds[2]?.shuffle.isPossible).toBe(true);
    // Two Fascists left in an eight-card pile cannot yield a hand of three.
    expect(analysis.rounds[3]?.shuffle.isPossible).toBe(false);
  });
});

describe('victory', () => {
  it('is undecided while both tracks are short', () => {
    const analysis = analyseGame(buildGame([{ enacted: Policy.Fascist, wasElected: true }]));

    expect(analysis.victory).toBeUndefined();
  });

  it('goes to the Fascists on the sixth Fascist law', () => {
    const analysis = analyseGame(buildGame(
      Array.from({ length: 6 }, () => ({ enacted: Policy.Fascist, wasElected: true }))
    ));

    expect(analysis.victory).toEqual({ reason: 'by enacting 6 fascist laws', team: 'fascist' });
  });

  it('goes to the Liberals on the fifth Liberal law', () => {
    const analysis = analyseGame(buildGame(
      Array.from({ length: 5 }, () => ({ enacted: Policy.Liberal, wasElected: true }))
    ));

    expect(analysis.victory).toEqual({ reason: 'by enacting 5 liberal laws', team: 'liberal' });
  });

  it('goes to the Fascists when Hitler is elected in the zone', () => {
    const analysis = analyseGame(buildGame([
      ...Array.from({ length: 3 }, () => ({ enacted: Policy.Fascist, wasElected: true })),
      { chancellorId: 'charlie', hitlerCheckAnswer: 'yes', presidentId: 'delta', wasElected: true }
    ]));

    expect(analysis.victory?.team).toBe('fascist');
    expect(analysis.victory?.reason).toContain('electing Hitler as chancellor');
  });

  /*
   * "If that player is Hitler, he reveals his Role Card and the game ends in a Liberal victory."
   * Forced to be truthful, so it decides the game outright.
   */
  it('goes to the Liberals when the executed player was Hitler', () => {
    const analysis = analyseGame(buildGame([
      { enacted: Policy.Fascist, executionTargetId: 'echo', presidentId: 'alpha', wasElected: true, wasExecutedPlayerHitler: true }
    ]));

    expect(analysis.victory).toEqual({ reason: 'by killing Hitler', team: 'liberal' });
  });

  it('is unaffected by executing someone who was not Hitler', () => {
    const analysis = analyseGame(buildGame([
      { enacted: Policy.Fascist, executionTargetId: 'echo', presidentId: 'alpha', wasElected: true, wasExecutedPlayerHitler: false }
    ]));

    expect(analysis.victory).toBeUndefined();
  });
});

describe('the rotation', () => {
  /*
   * The rulebook picks the first President at random. The app starts at the first seat instead, so
   * the Presidency is never something to choose — it is always derived.
   */
  it('starts at the first seat', () => {
    expect(analyseGame(buildGame([])).nextPresidentId).toBe('alpha');
  });

  it('moves to the next seat', () => {
    const analysis = analyseGame(buildGame([{ enacted: Policy.Fascist, presidentId: 'alpha', wasElected: true }]));

    expect(analysis.nextPresidentId).toBe('bravo');
  });

  it('moves on after a rejected election too', () => {
    const analysis = analyseGame(buildGame([{ presidentId: 'alpha', wasElected: false }]));

    expect(analysis.nextPresidentId).toBe('bravo');
  });

  it('wraps around the circle', () => {
    const analysis = analyseGame(buildGame([{ enacted: Policy.Fascist, presidentId: 'echo', wasElected: true }]));

    expect(analysis.nextPresidentId).toBe('alpha');
  });

  it('skips the dead', () => {
    const analysis = analyseGame(buildGame([
      { enacted: Policy.Fascist, executionTargetId: 'bravo', presidentId: 'alpha', wasElected: true }
    ]));

    expect(analysis.nextPresidentId).toBe('charlie');
  });

  it('hands the seat to a Special Election appointee', () => {
    const analysis = analyseGame(buildGame([
      { enacted: Policy.Fascist, presidentId: 'alpha', specialElectionTargetId: 'delta', wasElected: true }
    ]));

    expect(analysis.nextPresidentId).toBe('delta');
  });

  /*
   * "After a Special Election, the President placard returns to the left of the President who
   * enacted the Special Election." So the appointee is an interruption, not a new starting point.
   */
  it('resumes from the caller after a Special Election, not from the appointee', () => {
    const analysis = analyseGame(buildGame([
      { enacted: Policy.Fascist, presidentId: 'alpha', specialElectionTargetId: 'delta', wasElected: true },
      { enacted: Policy.Fascist, presidentId: 'delta', wasElected: true }
    ]));

    expect(analysis.nextPresidentId).toBe('bravo');
  });
});

describe('executions', () => {
  it('records who was killed', () => {
    const analysis = analyseGame(buildGame([
      { enacted: Policy.Fascist, executionTargetId: 'echo', presidentId: 'alpha', wasElected: true }
    ]));

    expect(analysis.deadPlayerIds).toEqual(['echo']);
  });
});

describe('an impossible Hitler', () => {
  /*
   * Hitler is one of the players and the zone check is the one answer the rules force to be honest,
   * so clearing everybody is not a suspicious record, it is a broken one.
   */
  function buildClearedGame(clearedIds: readonly string[]): Round[] {
    const threeFascistLaws: Round[] = Array.from({ length: 3 }, () => ({
      chancellorId: 'bravo',
      enacted: Policy.Fascist,
      presidentId: 'alpha',
      wasElected: true
    }));

    return [
      ...threeFascistLaws,
      ...clearedIds.map((chancellorId) => ({
        chancellorId,
        enacted: Policy.Liberal,
        hitlerCheckAnswer: 'no' as const,
        presidentId: 'alpha',
        wasElected: true
      }))
    ];
  }

  it('says nothing while somebody could still be him', () => {
    const analysis = analyseGame(buildGame(buildClearedGame(['alpha', 'bravo', 'charlie', 'delta'])));

    expect(analysis.confirmedNotHitler).toHaveLength(4);
    expect(analysis.hasImpossibleHitler).toBe(false);
  });

  it('objects once the last living player has been cleared', () => {
    const analysis = analyseGame(buildGame(buildClearedGame(['alpha', 'bravo', 'charlie', 'delta', 'echo'])));

    expect(analysis.hasImpossibleHitler).toBe(true);
  });

  /*
   * With Hitler shot there is nobody left to be him, and everyone alive being clear is exactly what
   * the record should look like.
   */
  it('accepts everyone being cleared once Hitler has been executed', () => {
    const rounds = buildClearedGame(['alpha', 'bravo', 'charlie', 'delta']);
    const analysis = analyseGame(buildGame([
      ...rounds,
      {
        chancellorId: 'bravo',
        enacted: Policy.Fascist,
        executionTargetId: 'echo',
        presidentId: 'alpha',
        wasElected: true,
        wasExecutedPlayerHitler: true
      }
    ]));

    expect(analysis.deadPlayerIds).toContain('echo');
    expect(analysis.hasImpossibleHitler).toBe(false);
  });

  it('counts an executed player as accounted for rather than as a suspect', () => {
    const rounds = buildClearedGame(['alpha', 'bravo', 'charlie']);
    const analysis = analyseGame(buildGame([
      ...rounds,
      {
        chancellorId: 'bravo',
        enacted: Policy.Fascist,
        executionTargetId: 'delta',
        presidentId: 'alpha',
        wasElected: true,
        wasExecutedPlayerHitler: false
      },
      {
        chancellorId: 'echo',
        enacted: Policy.Liberal,
        hitlerCheckAnswer: 'no',
        presidentId: 'alpha',
        wasElected: true
      }
    ]));

    expect(analysis.hasImpossibleHitler).toBe(true);
  });
});
