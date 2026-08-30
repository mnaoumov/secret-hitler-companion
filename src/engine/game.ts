import type {
  ClaimAssessment,
  LieFinding,
  UnusualPlay
} from './claims.ts';
import type { DeckState } from './deck.ts';
import type { PresidentialPower } from './rules.ts';
import type {
  DiscardModel,
  ProbabilityBounds,
  SessionAnalysis
} from './session.ts';

import {
  assessClaim,
  findLies,
  findUnusualPlays
} from './claims.ts';
import {
  createFullDeck,
  removeRevealedTopCard,
  reshuffle
} from './deck.ts';
import {
  DRAW_SIZE,
  Policy
} from './policy.ts';
import {
  ELECTION_TRACKER_LIMIT,
  FASCIST_TRACK_LENGTH,
  getPowerForFascistPolicy,
  getTermLimitedPlayers,
  HITLER_ZONE_THRESHOLD,
  LIBERAL_TRACK_LENGTH
} from './rules.ts';
import { analyseSession } from './session.ts';

export interface Game {
  readonly players: readonly Player[];
  readonly rounds: readonly Round[];
}

export interface GameAnalysis {
  /** Players proved not to be Hitler by surviving the Hitler-zone check. */
  readonly confirmedNotHitler: readonly string[];
  /**
   * Index of the first round in the current shuffle cycle.
   *
   * A reshuffle rebuilds the pile from the discard pile, so its composition stops depending on
   * anything claimed before it. Assumptions about earlier rounds cannot move a single number after
   * that point, and the interface should not pretend otherwise.
   */
  readonly currentCycleStartIndex: number;
  readonly deadPlayerIds: readonly string[];
  readonly deckAfter: DeckState;
  readonly enactedFascistCount: number;
  readonly enactedLiberalCount: number;

  /**
   * Set when the record has proved that nobody left alive is Hitler, which cannot be true.
   *
   * Hitler is one of the players. Surviving the zone check proves a Chancellor is not him, so if
   * every living player has survived it, one of those answers was a lie — the rules force the truth
   * there, so what has really happened is that a round was recorded wrongly.
   *
   * Not raised when Hitler has been executed: he is then accounted for, and the living being clear
   * of suspicion is exactly what one would expect.
   */
  readonly hasImpossibleHitler: boolean;

  readonly isFascistVictoryByHitler: boolean;

  /**
   * Who holds the Presidency next, taking the players as seated in a circle.
   *
   * `undefined` only for the very first government, whose President is drawn at random and so cannot
   * be derived from anything.
   */
  readonly nextPresidentId: string | undefined;

  readonly rounds: readonly RoundAnalysis[];

  /**
   * Who may not be nominated Chancellor in the next government, by the term-limit rule. Empty after
   * a policy the populace enacted itself, which frees everybody.
   */
  readonly termLimitedPlayerIds: readonly string[];

  /** Set once the game is decided. Nothing further should be recordable after this. */
  readonly victory: undefined | Victory;
}

export interface GetSuccessorIdParams {
  readonly afterPlayerId: string;
  readonly deadPlayerIds: readonly string[];
  readonly players: readonly Player[];
}

export interface Investigation {
  /** What the President told the table, if he said anything. He is free to lie. */
  readonly reported: Policy | undefined;
  readonly targetId: string;
}

export interface ModelAnalysis {
  readonly chancellorClaim: ClaimAssessment | undefined;
  readonly drawProbabilities: readonly number[];
  readonly isPossible: boolean;
  readonly passProbabilityBounds: readonly ProbabilityBounds[];
  readonly presidentClaim: ClaimAssessment | undefined;
}

export interface Player {
  readonly id: string;
  readonly name: string;
}

/**
 * One election attempt, together with whatever followed it.
 *
 * Only `enacted` and the two claims feed the probability engine; seats, votes and powers are
 * history. That is deliberate — it keeps the per-round input down to three taps at a live table.
 */
export interface Round {
  /**
   * Which hands the President is assumed to have drawn, regardless of what he said.
   *
   * A set rather than a single value, so the table can narrow without committing — "it was FFL or
   * FLL" is a real state of knowledge. One entry fixes the hand, every entry assumes nothing, and
   * dropping just the claimed hand is how you say you disbelieve him.
   *
   * This is the owner's `P(A2|A1)` / `P(A2|A1')` tree made walkable: constraining a round narrows
   * the worlds the filter keeps and every later round is recomputed against it. The tree is never
   * materialised — the deck is a sufficient statistic for the whole truth-history, so the `2^n`
   * branches collapse into one forward pass.
   */
  readonly assumedDrawFascistCounts?: readonly number[] | undefined;

  /**
   * Which pairs the Chancellor is assumed to have received. `undefined` assumes nothing.
   */
  readonly assumedPassFascistCounts?: readonly number[] | undefined;

  readonly chancellorClaim?: number | undefined;
  readonly chancellorId?: string | undefined;

  /** The policy placed face up by the government. Absent when the round was rejected or vetoed. */
  readonly enacted?: Policy | undefined;

  readonly executionTargetId?: string | undefined;

  /** Enacted by the populace because this was the third failed election in a row. */
  readonly forcedEnactment?: Policy | undefined;

  /**
   * The Chancellor's answer once three Fascist policies are up. This is the only statement in the
   * game the rules force to be truthful, so a `no` is proof rather than testimony.
   */
  readonly hitlerCheckAnswer?: 'no' | 'yes' | undefined;

  readonly investigation?: Investigation | undefined;

  readonly isVetoed?: boolean | undefined;
  /** The top three as the President reported them, in order. He is free to lie. */
  readonly peek?: readonly Policy[] | undefined;

  readonly presidentClaim?: number | undefined;

  /**
   * Which card the President says he discarded.
   *
   * The table asks him both halves — what he drew and what he binned — so his account names the
   * pair he handed over. That is what makes a lying Chancellor catchable: the two men are then
   * describing the same two cards, and any disagreement is theirs rather than an artefact of the
   * app inferring one from the other.
   */
  readonly presidentDiscard?: Policy | undefined;

  readonly presidentId?: string | undefined;
  readonly specialElectionTargetId?: string | undefined;
  /** Keyed by player id; `true` is ja. */
  readonly votes?: Readonly<Record<string, boolean>> | undefined;

  readonly wasElected: boolean;

  /**
   * Whether the executed player turned out to be Hitler.
   *
   * The rules force this one to be truthful — Hitler must reveal himself if assassinated — so a
   * `true` here ends the game for the Liberals and a `false` is proof the target was not Hitler.
   */
  readonly wasExecutedPlayerHitler?: boolean | undefined;
}

export interface RoundAnalysis extends RoundFacts {
  readonly shuffle: ModelAnalysis;
  readonly uniform: ModelAnalysis;
}

/**
 * How the game ended.
 *
 * All four conditions are public facts rather than deductions: policies on the track are face up,
 * and the two Hitler outcomes are the only moments the rules compel the truth.
 */
export interface Victory {
  readonly reason: string;
  readonly team: 'fascist' | 'liberal';
}

interface FilterStep extends RoundFacts {
  readonly model: ModelAnalysis;
}

interface GetVictoryParams {
  readonly enactedFascistCount: number;
  readonly enactedLiberalCount: number;
  readonly isFascistVictoryByHitler: boolean;
  readonly wasHitlerExecuted: boolean;
}

/** The bookkeeping a round produces, which is identical under both discard models. */
interface RoundFacts {
  /** Carried from the shuffle track, since that is the assumption-free one. */
  readonly deckAfter: DeckState;

  readonly deckBefore: DeckState;
  readonly didReshuffle: boolean;
  readonly electionTracker: number;
  readonly enactedFascistCount: number;
  readonly enactedLiberalCount: number;
  /**
   * Who the President named Fascist party, when he named anyone.
   *
   * A standing dispute, because no Fascist admits it: the accused denies it, and one of the two is
   * lying. What that proves is the stronger half — a Liberal does not accuse falsely, so if the
   * report is untrue the man who made it is Fascist himself. So at least one of the pair is Fascist
   * party, and the pairs compose: with only three or four such cards in the game, two disjoint
   * pairs go a long way.
   *
   * At least, not exactly: both being Fascist is consistent, and it is a play — the report is then
   * true and the accuser is paid in credibility for naming his own. Only both-Liberal is excluded.
   *
   * Rests on the same "a Liberal never lies" convention as the government posterior, and on nothing
   * about the shuffle — this is a reading of what was said out loud.
   */
  readonly investigationDispute: string | undefined;

  /**
   * Who the President vouched for, when he reported anyone Liberal party.
   *
   * The mirror of the accusation, and it carries information too — a report nobody disputes is
   * still a statement a Liberal could not have made falsely. So the President being Liberal makes
   * the man he named Liberal, and the two are chained one way: what condemns the named man
   * condemns the man who vouched for him.
   *
   * Not a conflict. Nothing here contradicts anything, which is why it is kept apart from the
   * lies — but every investigation now says something, rather than only the hostile ones.
   */
  readonly investigationEndorsement: string | undefined;

  /**
   * What the record proves about who lied. Names a seat when the enacted policy refutes that seat's
   * own claim; falls back to "one of them" only when neither claim is refuted on its own.
   */
  readonly lies: readonly LieFinding[];

  /** A peek claim the following draw turned out to contradict. */
  readonly peekContradiction: boolean;

  readonly power: null | PresidentialPower;

  /**
   * Legal but odd plays the claims imply — someone took the Fascist option with a Liberal one in
   * hand. Independent of the discard model, because it reads the claims rather than the shuffle.
   */
  readonly unusualPlays: readonly UnusualPlay[];
}

export function analyseGame(game: Game): GameAnalysis {
  const shuffleTrack = runFilter(game, 'shuffle');
  const uniformTrack = runFilter(game, 'uniform');
  const confirmedNotHitler: string[] = [];
  const deadPlayerIds: string[] = [];
  let enactedFascistCount = 0;
  let enactedLiberalCount = 0;
  let isFascistVictoryByHitler = false;
  let lastPresident: string | undefined;
  let lastChancellor: string | undefined;

  const rounds: RoundAnalysis[] = game.rounds.map((round, index) => {
    const shuffle = shuffleTrack[index];
    const uniform = uniformTrack[index];

    if (!shuffle || !uniform) {
      throw new Error(`Missing analysis for round ${String(index)}.`);
    }

    /*
     * The check happens on election, before the legislative session, so it is governed by the
     * Fascist count going *into* this round. Outside the Hitler zone the question is never asked and
     * an answer proves nothing — only in the zone do the rules force the truth.
     */
    const fascistCountBefore = shuffleTrack[index - 1]?.enactedFascistCount ?? 0;
    const isInHitlerZone = fascistCountBefore >= HITLER_ZONE_THRESHOLD;

    if (isInHitlerZone && round.hitlerCheckAnswer === 'yes') {
      isFascistVictoryByHitler = true;
    }

    if (
      isInHitlerZone
      && round.hitlerCheckAnswer === 'no'
      && round.chancellorId
      && !confirmedNotHitler.includes(round.chancellorId)
    ) {
      confirmedNotHitler.push(round.chancellorId);
    }

    if (round.executionTargetId && !deadPlayerIds.includes(round.executionTargetId)) {
      deadPlayerIds.push(round.executionTargetId);
    }

    /*
     * Term limits follow the last government that actually formed. A policy the populace enacts
     * after three failed elections explicitly frees everyone again, so it clears the pair rather
     * than leaving the previous one in force.
     */
    if (round.wasElected) {
      lastPresident = round.presidentId;
      lastChancellor = round.chancellorId;
    }

    /*
     * A policy the populace enacts explicitly frees everybody, so it clears the pair rather than
     * leaving the previous government in force. Checked after the election above, because a vetoed
     * government can be the very round that triggers it.
     */
    if (round.forcedEnactment) {
      lastPresident = undefined;
      lastChancellor = undefined;
    }

    enactedFascistCount = shuffle.enactedFascistCount;
    enactedLiberalCount = shuffle.enactedLiberalCount;

    const { model, ...facts } = shuffle;

    return {
      ...facts,
      shuffle: model,
      uniform: uniform.model
    };
  });

  const lastReshuffleIndex = rounds.findLastIndex((round) => round.didReshuffle);

  const wasHitlerExecuted = game.rounds.some((round) => round.wasExecutedPlayerHitler === true);

  /*
   * Everyone still at the table has been cleared, and Hitler has not been shot. He is therefore
   * nowhere, which is not a state the game has.
   */
  const hasImpossibleHitler = !wasHitlerExecuted
    && game.players.length > 0
    && game.players.every((player) => deadPlayerIds.includes(player.id) || confirmedNotHitler.includes(player.id));

  return {
    confirmedNotHitler,
    currentCycleStartIndex: lastReshuffleIndex + 1,
    deadPlayerIds,
    deckAfter: rounds.at(-1)?.deckAfter ?? createFullDeck(),
    enactedFascistCount,
    enactedLiberalCount,
    hasImpossibleHitler,
    isFascistVictoryByHitler,
    nextPresidentId: getNextPresidentId(game, deadPlayerIds),
    rounds,
    termLimitedPlayerIds: getTermLimitedPlayers({
      lastChancellor,
      lastPresident,
      livingPlayerCount: game.players.length - deadPlayerIds.length,
      playerCount: game.players.length
    }),
    victory: getVictory({
      enactedFascistCount,
      enactedLiberalCount,
      isFascistVictoryByHitler,
      wasHitlerExecuted
    })
  };
}

/**
 * The seat the placard reaches next by rotation alone.
 *
 * Not the same question as who is President next, which a Special Election overrides for one round.
 * This is "whose turn is it" — and because an appointee never becomes the anchor, it is also who
 * takes the seat *after* an appointee. Both are what a power play is measured against.
 */
export function getRotationSuccessorId(game: Game, deadPlayerIds: readonly string[]): string | undefined {
  const anchorId = getRotationAnchorId(game);

  if (anchorId === undefined) {
    return undefined;
  }

  return getSuccessorId({ afterPlayerId: anchorId, deadPlayerIds, players: game.players });
}

/** The next living seat clockwise. Exported so the interface can look one seat ahead too. */
export function getSuccessorId(params: GetSuccessorIdParams): string | undefined {
  const { afterPlayerId, deadPlayerIds, players } = params;
  const index = players.findIndex((player) => player.id === afterPlayerId);

  if (index === -1) {
    return undefined;
  }

  for (let step = 1; step <= players.length; step++) {
    const candidate = players[(index + step) % players.length];

    if (candidate && !deadPlayerIds.includes(candidate.id)) {
      return candidate.id;
    }
  }

  return undefined;
}

function buildConstraints(round: Round): Pick<Parameters<typeof analyseSession>[0], 'allowedDrawFascistCounts' | 'allowedPassFascistCounts'> {
  return {
    allowedDrawFascistCounts: round.assumedDrawFascistCounts,
    allowedPassFascistCounts: round.assumedPassFascistCounts
  };
}

function buildModelAnalysis(round: Round, analysis: SessionAnalysis | undefined): ModelAnalysis {
  if (!analysis) {
    return {
      chancellorClaim: undefined,
      drawProbabilities: [],
      isPossible: true,
      passProbabilityBounds: [],
      presidentClaim: undefined
    };
  }

  const presidentProbability = round.presidentClaim === undefined
    ? undefined
    : analysis.drawProbabilities[round.presidentClaim] ?? 0;

  return {
    chancellorClaim: round.chancellorClaim === undefined
      ? undefined
      : assessClaim(analysis.passProbabilityBounds[round.chancellorClaim] ?? { max: 0, min: 0 }),
    drawProbabilities: analysis.drawProbabilities,
    isPossible: analysis.isPossible,
    passProbabilityBounds: analysis.passProbabilityBounds,
    presidentClaim: presidentProbability === undefined
      ? undefined
      : assessClaim({ max: presidentProbability, min: presidentProbability })
  };
}

/**
 * A Policy Peek is an ordered look that puts the cards back untouched, so the very next draw is
 * exactly those three cards — unless something removed a card in between. When the next President
 * claims a different hand, one of the two is lying.
 */
function doesPeekContradictNextDraw(rounds: readonly Round[], index: number): boolean {
  const peek = rounds[index]?.peek;

  if (peek?.length !== DRAW_SIZE) {
    return false;
  }

  const next = rounds[index + 1];

  if (!next?.wasElected || next.presidentClaim === undefined || next.forcedEnactment) {
    return false;
  }

  const peekedFascistCount = peek.filter((policy) => policy === Policy.Fascist).length;

  return peekedFascistCount !== next.presidentClaim;
}

/*
 * The placard moves one seat clockwise every round — after a rejected election too, and even if the
 * next player was just in government. The dead are skipped; they may not hold office.
 *
 * A Special Election is an interruption rather than a new starting point: the rulebook is explicit
 * that afterwards the placard "returns to the left of the President who enacted the Special
 * Election". So the rotation is anchored on the last President who arrived by rotation, and an
 * appointee never becomes that anchor.
 */
function getNextPresidentId(game: Game, deadPlayerIds: readonly string[]): string | undefined {
  const living = game.players.filter((player) => !deadPlayerIds.includes(player.id));

  if (living.length === 0) {
    return undefined;
  }

  const lastRound = game.rounds.at(-1);

  // The rulebook picks the first President at random; the app just starts at the first seat.
  if (!lastRound) {
    return living[0]?.id;
  }

  if (lastRound.specialElectionTargetId !== undefined) {
    return lastRound.specialElectionTargetId;
  }

  return getRotationSuccessorId(game, deadPlayerIds) ?? living[0]?.id;
}

/** The most recent President who took the seat by rotation rather than by appointment. */
function getRotationAnchorId(game: Game): string | undefined {
  for (let index = game.rounds.length - 1; index >= 0; index--) {
    const presidentId = game.rounds[index]?.presidentId;

    if (presidentId === undefined) {
      continue;
    }

    const wasAppointed = game.rounds[index - 1]?.specialElectionTargetId === presidentId;

    if (!wasAppointed) {
      return presidentId;
    }
  }

  return undefined;
}

/*
 * Checked in the order the game itself resolves them: the two Hitler conditions end play the instant
 * they happen, before any policy could be enacted on top of them.
 */
function getVictory(params: GetVictoryParams): undefined | Victory {
  if (params.isFascistVictoryByHitler) {
    return {
      reason: `by electing Hitler as Chancellor after ${String(HITLER_ZONE_THRESHOLD)} Fascist laws enacted`,
      team: 'fascist'
    };
  }

  if (params.wasHitlerExecuted) {
    return { reason: 'by executing Hitler', team: 'liberal' };
  }

  if (params.enactedFascistCount >= FASCIST_TRACK_LENGTH) {
    return { reason: `by enacting ${String(FASCIST_TRACK_LENGTH)} Fascist laws`, team: 'fascist' };
  }

  if (params.enactedLiberalCount >= LIBERAL_TRACK_LENGTH) {
    return { reason: `by enacting ${String(LIBERAL_TRACK_LENGTH)} Liberal laws`, team: 'liberal' };
  }

  return undefined;
}

function runFilter(game: Game, discardModel: DiscardModel): FilterStep[] {
  const steps: FilterStep[] = [];
  let deck = createFullDeck();
  let electionTracker = 0;
  let enactedFascistCount = 0;
  let enactedLiberalCount = 0;

  for (const [index, round] of game.rounds.entries()) {
    const deckBefore = deck;
    let didReshuffle = false;
    let analysis: SessionAnalysis | undefined;

    if (round.wasElected) {
      if (round.isVetoed) {
        // All three cards leave the pile: the one he discarded, and the two the veto discards.
        analysis = analyseSession({ ...buildConstraints(round), deck, discardModel, enacted: null });
        deck = analysis.deckAfter;

        /*
         * A veto plays no tile face up, so it does NOT reset the tracker — the rulebook resets it
         * only when a Policy is played, "whether it was enacted by an elected government or enacted
         * by the frustrated populace". The veto is an inactive government and advances it instead,
         * which means a veto can be the third inactive government and throw the country into chaos.
         */
        electionTracker++;
      } else if (round.enacted) {
        analysis = analyseSession({ ...buildConstraints(round), deck, discardModel, enacted: round.enacted });
        deck = analysis.deckAfter;
        electionTracker = 0;

        if (round.enacted === Policy.Fascist) {
          enactedFascistCount++;
        } else {
          enactedLiberalCount++;
        }
      }
    } else {
      electionTracker++;
    }

    /*
     * Chaos, and it is reachable two ways: three rejected governments, or a tracker pushed to the
     * limit by a veto. Sitting outside the election branch is what lets the second one work.
     */
    if (electionTracker >= ELECTION_TRACKER_LIMIT && round.forcedEnactment) {
      deck = removeRevealedTopCard(deck, round.forcedEnactment);
      electionTracker = 0;

      if (round.forcedEnactment === Policy.Fascist) {
        enactedFascistCount++;
      } else {
        enactedLiberalCount++;
      }
    }

    // The pile is rebuilt whenever it can no longer supply a full draw.
    if (deck.size < DRAW_SIZE) {
      deck = reshuffle(enactedFascistCount, enactedLiberalCount);
      didReshuffle = true;
    }

    steps.push({
      deckAfter: deck,
      deckBefore,
      didReshuffle,
      electionTracker,
      enactedFascistCount,
      enactedLiberalCount,
      investigationDispute: round.investigation?.reported === Policy.Fascist
        ? round.investigation.targetId
        : undefined,
      investigationEndorsement: round.investigation?.reported === Policy.Liberal
        ? round.investigation.targetId
        : undefined,
      lies: findLies({
        chancellorFascistCount: round.chancellorClaim,
        enacted: round.enacted,
        presidentDiscard: round.presidentDiscard,
        presidentFascistCount: round.presidentClaim
      }),
      model: buildModelAnalysis(round, analysis),
      peekContradiction: doesPeekContradictNextDraw(game.rounds, index),
      power: round.enacted === Policy.Fascist
        ? getPowerForFascistPolicy(game.players.length, enactedFascistCount)
        : null,
      unusualPlays: findUnusualPlays({
        chancellorFascistCount: round.chancellorClaim,
        enacted: round.enacted,
        presidentDiscard: round.presidentDiscard,
        presidentFascistCount: round.presidentClaim
      })
    });
  }

  return steps;
}
