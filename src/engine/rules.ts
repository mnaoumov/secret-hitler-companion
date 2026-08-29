export type PresidentialPower = 'execution' | 'investigateLoyalty' | 'policyPeek' | 'specialElection';

export const MAX_PLAYER_COUNT = 10;
export const MIN_PLAYER_COUNT = 5;

/** Fascist policies needed before an elected Chancellor must be asked whether he is Hitler. */
export const HITLER_ZONE_THRESHOLD = 3;

/** Fascist policies needed before the Chancellor may veto. */
export const VETO_THRESHOLD = 5;

export const FASCIST_TRACK_LENGTH = 6;
export const LIBERAL_TRACK_LENGTH = 5;

/** Failed elections in a row before the populace enacts the top policy itself. */
export const ELECTION_TRACKER_LIMIT = 3;

export interface PlayerCountRules {
  /** Ordinary Fascists, not counting Hitler. */
  readonly fascistCount: number;
  readonly hitlerKnowsFascists: boolean;
  readonly liberalCount: number;

  /**
   * The power granted by each Fascist policy, indexed from the first. Read off the physical Fascist
   * Track boards in the print-and-play (`color.pdf`), because the rulebook text does not carry the
   * table — it says only "look at the Fascist Track".
   */
  readonly powers: readonly (null | PresidentialPower)[];
}

const EXECUTION_TAIL: readonly (null | PresidentialPower)[] = ['execution', 'execution'];

const SMALL_GAME_POWERS: readonly (null | PresidentialPower)[] = [null, null, 'policyPeek', ...EXECUTION_TAIL];
const MEDIUM_GAME_POWERS: readonly (null | PresidentialPower)[] = [
  null,
  'investigateLoyalty',
  'specialElection',
  ...EXECUTION_TAIL
];
const LARGE_GAME_POWERS: readonly (null | PresidentialPower)[] = [
  'investigateLoyalty',
  'investigateLoyalty',
  'specialElection',
  ...EXECUTION_TAIL
];

/*
 * The setup table, transcribed from the rulebook's own table and the printed Fascist Track boards.
 * Every literal below is the datum itself, so naming them would hide the table rather than explain
 * it — hence the scoped exemption on the next line.
 */
/* eslint-disable no-magic-numbers -- Transcribed rules table; each literal is the datum. */
const RULES_BY_PLAYER_COUNT = new Map<number, PlayerCountRules>([
  [10, { fascistCount: 3, hitlerKnowsFascists: false, liberalCount: 6, powers: LARGE_GAME_POWERS }],
  [5, { fascistCount: 1, hitlerKnowsFascists: true, liberalCount: 3, powers: SMALL_GAME_POWERS }],
  [6, { fascistCount: 1, hitlerKnowsFascists: true, liberalCount: 4, powers: SMALL_GAME_POWERS }],
  [7, { fascistCount: 2, hitlerKnowsFascists: false, liberalCount: 4, powers: MEDIUM_GAME_POWERS }],
  [8, { fascistCount: 2, hitlerKnowsFascists: false, liberalCount: 5, powers: MEDIUM_GAME_POWERS }],
  [9, { fascistCount: 3, hitlerKnowsFascists: false, liberalCount: 5, powers: LARGE_GAME_POWERS }]
]);
/* eslint-enable no-magic-numbers -- End of the transcribed table. */

/** Comparing `ja * 2 > total` keeps the majority test in integers, so a tie cannot round into a win. */
const MAJORITY_DOUBLING = 2;

export interface GetTermLimitedPlayersParams {
  readonly lastChancellor: string | undefined;
  readonly lastPresident: string | undefined;
  readonly livingPlayerCount: number;
  readonly playerCount: number;
}

export function getPlayerCountRules(playerCount: number): PlayerCountRules {
  const rules = RULES_BY_PLAYER_COUNT.get(playerCount);

  if (!rules) {
    throw new RangeError(`Secret Hitler is played by ${String(MIN_PLAYER_COUNT)} to ${String(MAX_PLAYER_COUNT)} players, not ${String(playerCount)}.`);
  }

  return rules;
}

/** The power the n-th Fascist policy grants, or `null` when it grants none. */
export function getPowerForFascistPolicy(playerCount: number, fascistPolicyNumber: number): null | PresidentialPower {
  return getPlayerCountRules(playerCount).powers[fascistPolicyNumber - 1] ?? null;
}

/**
 * Who may not be nominated Chancellor.
 *
 * The rulebook says literally: "In a five-player game, only the last active Chancellor is
 * ineligible; the last President may be nominated. In all other games, neither the last President
 * nor the last Chancellor may be nominated."
 *
 * The `livingPlayerCount` arm goes beyond that literal text: it extends the five-player relaxation
 * to any game worn down to five survivors by executions. The rulebook says "in a five-player game",
 * which reads as the starting count — but the owner confirmed (2026-08-28) that this is how it is
 * played, precisely so a six- or seven-player game that has lost people to executions does not run
 * out of eligible candidates. Deliberate house reading, recorded rather than discarded.
 *
 * A policy enacted by the populace after three failed elections frees everyone, which is why this
 * takes the last *elected* government rather than the last round.
 */
export function getTermLimitedPlayers(params: GetTermLimitedPlayersParams): string[] {
  const { lastChancellor, lastPresident, livingPlayerCount, playerCount } = params;

  if (livingPlayerCount <= MIN_PLAYER_COUNT || playerCount === MIN_PLAYER_COUNT) {
    return lastChancellor ? [lastChancellor] : [];
  }

  return [lastChancellor, lastPresident].filter((player) => player !== undefined);
}

/**
 * An election needs strictly more than half the living players, so a tie fails. The placards say
 * "at least 50%", but the rulebook is explicit that a tie advances the election tracker.
 */
export function isElected(jaCount: number, livingPlayerCount: number): boolean {
  return jaCount * MAJORITY_DOUBLING > livingPlayerCount;
}
