import type {
  ClaimAssessment,
  UnusualPlay
} from '../engine/claims.ts';
import type { DeckState } from '../engine/deck.ts';
import type {
  Game,
  GameAnalysis,
  Player,
  Round,
  RoundAnalysis
} from '../engine/game.ts';

import {
  areClaimsConsistent,
  canEnactFromClaimedDraw,
  canEnactFromClaimedPass,
  getChancellorDiscard,
  getClaimedPassFascistCount
} from '../engine/claims.ts';
import {
  getDrawDistribution,
  getExactFascistCount,
  getOrderedDrawProbability,
  getTopCardFascistProbability
} from '../engine/deck.ts';
import {
  analyseGame,
  getSuccessorId
} from '../engine/game.ts';
import {
  DRAW_SIZE,
  formatHand,
  PASS_SIZE,
  Policy
} from '../engine/policy.ts';
import {
  ELECTION_TRACKER_LIMIT,
  FASCIST_TRACK_LENGTH,
  getPowerForFascistPolicy,
  HITLER_ZONE_THRESHOLD,
  isElected,
  LIBERAL_TRACK_LENGTH,
  MAX_PLAYER_COUNT,
  MIN_PLAYER_COUNT,
  VETO_THRESHOLD
} from '../engine/rules.ts';
import {
  clear,
  element,
  formatPercentage,
  textInput
} from './dom.ts';

interface AppState {
  draft: Draft;

  /** Whose dossier is open, if any. */
  inspectedPlayerId: string | undefined;

  /**
   * Whether the table has asked the app to remember and calculate.
   *
   * Off until somebody turns it on, and it stays wherever it is left, so a group can play blind and
   * open it later — mid-game, when deciding whether to seat a government they suspect, which is the
   * moment the tool is worth most. Nothing here blocks recording: the round is entered either way,
   * and turning it on is a decision about what the players want to be told, not about the data.
   *
   * The line it draws: what is physically on the table stays visible — the two tracks, the election
   * tracker, who is dead, who survived the Hitler check — because a player sitting there can see all
   * of it. What the app remembers for you and what it works out are behind the switch.
   */
  isAnalysisVisible: boolean;

  /**
   * Whether the history is open over the page.
   *
   * It was a permanent strip along the bottom, which cost a band of a screen that has none to spare
   * — and it is reference material, consulted a few times a game rather than watched. Overlaying it
   * on demand gives the round being entered the whole viewport.
   */
  isHistoryOpen: boolean;

  /**
   * Seating and names belong to setup, not to play.
   *
   * Changing the seat count mid-game would silently invalidate every recorded round — the rotation,
   * the term limits and the vote threshold all read off it — so it is settled once and then the
   * control is gone.
   */
  phase: 'playing' | 'setup';

  players: Player[];

  /** Whose name is being edited. Renaming is opt-in so the keyboard never opens by surprise. */
  renamingPlayerId: string | undefined;
  rounds: Round[];

  /** Index of the recorded round being reviewed, or `undefined` while entering the current one. */
  selectedRoundIndex: number | undefined;
}

interface Draft {
  chancellorClaim?: number | undefined;
  chancellorId?: string | undefined;
  enacted?: Policy | undefined;

  executionTargetId?: string | undefined;
  /** Revealed off the top because this was the third rejection in a row. */
  forcedEnactment?: Policy | undefined;
  hitlerCheckAnswer?: 'no' | 'yes' | undefined;
  investigationReported?: Policy | undefined;

  investigationTargetId?: string | undefined;

  /**
   * Whether the government vetoed the agenda.
   *
   * Only reachable once five Fascist policies are up. It is not a third kind of enacted policy: no
   * tile is played, all three cards are discarded, and the tracker advances as it does for any other
   * inactive government.
   */
  isVetoed?: boolean | undefined;

  /**
   * Set once the table says the vote is finished.
   *
   * Without it the outcome has to be guessed from how many votes happen to be in, which makes the
   * form resolve early and jump about while people are still voting — and leaves no way to tell a
   * finished unanimous ja from a vote still in progress.
   */
  isVoteConfirmed?: boolean | undefined;

  /** What the President said the top three were, in order. Sparse until he says. */
  peek: (Policy | undefined)[];

  presidentClaim?: number | undefined;

  /** Which card the President says he discarded, which is what fixes the pair he passed on. */
  presidentDiscard?: Policy | undefined;

  presidentId?: string | undefined;
  specialElectionTargetId?: string | undefined;
  votes: Record<string, boolean>;
  /** Whether the executed player turned out to be Hitler. The rules force a truthful answer. */
  wasExecutedPlayerHitler?: boolean | undefined;
}

/** Everything the readout needs, whether it is showing the draft or a round from the history. */
/** Why a seat may not be picked: a short form for the screen, a full one for the tooltip. */
interface Ineligibility {
  readonly note: string;
  readonly reason: string;

  /**
   * Which seat the note is about, so it can carry that seat's colour.
   *
   * Named rather than word-matched: the notes are written in lower case ("ex-president") and the
   * word-level colouring only catches the capitalised forms. Absent when the note is about neither
   * seat, as an execution is.
   */
  readonly seat?: 'chancellor' | 'president' | undefined;
}

interface ReadoutView {
  readonly analysis: RoundAnalysis;
  readonly chancellorClaim: number | undefined;
  readonly chancellorId: string | undefined;
  /** The pile once this round's cards are gone — what a Policy Peek is actually looking at. */
  readonly deckAfter: DeckState;

  readonly deckBefore: DeckState;
  readonly enacted: Policy | undefined;
  readonly isRecorded: boolean;

  /** What the President said the top three were, once he has said all three. */
  readonly peek: readonly Policy[] | undefined;

  readonly presidentClaim: number | undefined;
  readonly presidentId: string | undefined;
  readonly roundNumber: number;
}

interface ScrollPosition {
  readonly left: number;
  readonly top: number;
}

/** Regions that scroll independently and must survive a rebuild with their position intact. */
const SCROLLABLE_SELECTORS = ['.main', '.history'];

/*
 * The words and tokens that carry a colour, captured so `split` keeps them as their own pieces.
 *
 * `[FL]{2,3}` between word boundaries picks out a hand — FF, FFL, LLL — without touching "Fascist"
 * or "Liberal", whose next character is a letter and so never closes the boundary. Those two words
 * are listed in their own right: in this game the team colours and the card colours are the same
 * pair, so colouring the word is right whether it names a policy or a side.
 */
const COLOURED_TOKEN_PATTERN = /(?<token>Presidency|President|Chancellor|Fascist|Liberal|\b[FL]{2,3}\b)/g;

/** Longest a typed name may be. Long enough for any real name, short enough to keep the row tidy. */
const MAX_NAME_LENGTH = 16;

const state: AppState = {
  draft: createDraft(),
  inspectedPlayerId: undefined,
  isAnalysisVisible: false,
  isHistoryOpen: false,
  phase: 'setup',
  players: createPlayers(MIN_PLAYER_COUNT),
  renamingPlayerId: undefined,
  rounds: [],
  selectedRoundIndex: undefined
};

const appRoot = document.querySelector('#app');

if (appRoot instanceof HTMLElement) {
  render();
}

/*
 * A three-card hand can produce an enacted policy only if it actually held that colour: FFF can
 * never yield a Liberal, LLL can never yield a Fascist.
 */
function canProduceEnacted(drawFascistCount: number, enacted: Policy): boolean {
  return enacted === Policy.Fascist ? drawFascistCount > 0 : drawFascistCount < DRAW_SIZE;
}

/*
 * Every tap rebuilds the whole tree, which is cheap and rules out a class of stale-state bugs — but
 * a fresh element scrolls back to the top. Without this, tapping a vote near the bottom of the
 * fields column threw the row you were tapping off the screen.
 */
function captureScrollPositions(root: HTMLElement): Map<string, ScrollPosition> {
  const positions = new Map<string, ScrollPosition>();

  for (const selector of SCROLLABLE_SELECTORS) {
    const node = root.querySelector(selector);

    if (node instanceof HTMLElement && (node.scrollTop > 0 || node.scrollLeft > 0)) {
      positions.set(selector, { left: node.scrollLeft, top: node.scrollTop });
    }
  }

  return positions;
}

function closeHistory(): void {
  state.isHistoryOpen = false;
}

function commitRound(): void {
  state.rounds.push({
    ...getDraftRound(),
    assumedDrawFascistCounts: getDefaultAssumption()
  });
  state.draft = createDraft(analyseGame({ players: state.players, rounds: state.rounds }).nextPresidentId);
}

/*
 * The next President is fixed by the seating, so it is filled in rather than asked for. It stays a
 * normal button row, because a Special Election or a miscount has to be correctable in one tap.
 */
function createDraft(presidentId?: string): Draft {
  return { peek: [], presidentId, votes: {} };
}

/*
 * The default name is stored, not merely implied. An empty field gives no hint of what the seat will
 * be called, and leaves the setup screen looking unfinished when it is in fact ready to start.
 */
function createPlayer(index: number): Player {
  return { id: `player-${String(index + 1)}`, name: getDefaultName(index) };
}

/*
 * Seats start unnamed and show as "Player 1", "Player 2" and so on. The stored name stays empty
 * until somebody types one, which is what lets the label fall back cleanly and what tells the seat
 * buttons they may use the short `P1` form.
 *
 * The id never changes, so renaming mid-game cannot orphan a recorded round.
 */
function createPlayers(count: number): Player[] {
  return Array.from({ length: count }, (_unused, index) => createPlayer(index));
}

/*
 * Ordered, because the peek returns the cards to the top untouched — so if he shares it, the next
 * President's draw is exactly these three and the two stories can be checked against each other.
 */
/** Unset, then Fascist, then Liberal, then back — one target rather than three to aim at. */
function cyclePolicy(value: Policy | undefined): Policy | undefined {
  if (value === undefined) {
    return Policy.Fascist;
  }

  return value === Policy.Fascist ? Policy.Liberal : undefined;
}

/** Ja, then nein, then back to unrecorded — one target cycling rather than three to aim at. */
function cycleVote(playerId: string): void {
  // Changing a vote reopens the tally; the previous confirmation no longer describes it.
  state.draft.isVoteConfirmed = false;

  const vote = state.draft.votes[playerId];

  if (vote === undefined) {
    state.draft.votes = { ...state.draft.votes, [playerId]: true };

    return;
  }

  if (vote) {
    state.draft.votes = { ...state.draft.votes, [playerId]: false };

    return;
  }

  const { [playerId]: _cleared, ...rest } = state.draft.votes;
  state.draft.votes = rest;
}

/** Fascist-heaviest hand first, so the most incriminating claim sits at the top of every column. */
function descendingCounts(size: number): number[] {
  return Array.from({ length: size + 1 }, (_unused, index) => size - index);
}

// ---------- header ----------

function describeBounds(assessment: ClaimAssessment | undefined, view?: ReadoutView): string {
  if (!assessment) {
    return '';
  }

  if (assessment.verdict === 'forced') {
    return 'forced by the President\'s own claim — he had no other card to discard';
  }

  if (assessment.verdict === 'impossible') {
    return describeImpossiblePass(view);
  }

  /*
   * A range, not a single number, and deliberately so: which card the President passed on is his
   * decision, and the shuffle has nothing to say about it. The low end is how often the pair is
   * forced, the high end how often it is merely possible. Collapsing that to one figure would mean
   * inventing a model of how people discard.
   *
   * The range used to be followed by a sentence explaining that the gap is his choice. Two numbers
   * with a gap between them already say that, and it was read every round for no new information.
   */
  return `between ${formatPercentage(assessment.bounds.min)} and ${formatPercentage(assessment.bounds.max)}`;
}

/*
 * There is more than one way for a pair to be impossible, and saying the wrong one is worse than
 * saying nothing. Usually it is not the deck at all: a Chancellor holding FF simply cannot put up a
 * Liberal, no matter how the cards fell. Blaming the shuffle for that sent the owner looking for a
 * bug in the maths when the maths was right.
 */
function describeImpossiblePass(view: ReadoutView | undefined): string {
  if (!view?.enacted || view.chancellorClaim === undefined) {
    return 'no deal of the deck produces this';
  }

  if (!canEnactFromClaimedPass(view.chancellorClaim, view.enacted)) {
    const hand = formatHand(view.chancellorClaim, PASS_SIZE);
    const colour = view.enacted === Policy.Fascist ? 'Fascist' : 'Liberal';

    return `holding ${hand} he had no ${colour} law to enact`;
  }

  if (view.presidentClaim !== undefined && !areClaimsConsistent(view.presidentClaim, view.chancellorClaim)) {
    return 'this cannot follow from the President\'s claim — he discards exactly one card';
  }

  return 'the draw pile cannot supply this';
}

function describeMissingFields(analysis: GameAnalysis): string | undefined {
  if (state.draft.presidentId === undefined) {
    return 'Pick the President';
  }

  if (state.draft.chancellorId === undefined) {
    return 'Pick the Chancellor';
  }

  const deadIds = getDeadPlayerIds();
  const stillToVote = state.players.filter((player) => !deadIds.has(player.id) && state.draft.votes[player.id] === undefined);

  if (stillToVote.length > 0) {
    return `${String(stillToVote.length)} still to vote`;
  }

  if (state.draft.isVoteConfirmed !== true) {
    return 'Confirm the vote';
  }

  if (isDraftElected()) {
    if (analysis.enactedFascistCount >= HITLER_ZONE_THRESHOLD && state.draft.hitlerCheckAnswer === undefined) {
      return 'Ask the Chancellor if he is Hitler';
    }

    // Nothing else is asked once he has been named: the game is over at that word.
    if (isHitlerElected()) {
      return undefined;
    }

    if (state.draft.isVetoed === true) {
      return isChaosImminent(analysis) && state.draft.forcedEnactment === undefined
        ? 'Which law came off the top?'
        : undefined;
    }

    return state.draft.enacted === undefined ? 'Which law was enacted?' : undefined;
  }

  if (isChaosImminent(analysis) && state.draft.forcedEnactment === undefined) {
    return 'Which law came off the top?';
  }

  return undefined;
}

/*
 * The buttons carry the seat, not the name, so the name has to be reachable some other way — a
 * hover on a laptop, a press-and-hold on a tablet. Any reason the seat is unavailable is appended
 * rather than replacing the name, so the tooltip never stops answering "who is this".
 */
function describeSeat(index: number, reason: string | undefined): string {
  const name = getDisplayName(index);

  return reason === undefined ? name : `${name} — ${reason}`;
}

function getActorClassName(actor: 'chancellor' | 'president' | 'unknown'): string {
  if (actor === 'president') {
    return 'is-president';
  }

  return actor === 'chancellor' ? 'is-chancellor' : '';
}

/*
 * Three separate bars, and the button says which one it hit rather than just refusing:
 * execution, the term limit on the last government, and the President's inability to nominate
 * himself.
 */
function getChancellorIneligibility(analysis: GameAnalysis): ReadonlyMap<string, Ineligibility> {
  if (state.draft.presidentId === undefined) {
    return new Map(state.players.map((player) => [player.id, { note: 'wait', reason: 'pick the President first' }]));
  }

  const ineligible = new Map<string, Ineligibility>(getPresidentIneligibility(analysis));

  /*
   * Term limits lock the last government, so the note names which seat that player held — "was in
   * the last government" leaves the table wondering which half of it, and that is exactly the thing
   * they are trying to remember.
   */
  const lastGovernment = state.rounds.findLast((round) => round.wasElected);

  for (const playerId of analysis.termLimitedPlayerIds) {
    const wasChancellor = lastGovernment?.chancellorId === playerId;

    ineligible.set(playerId, {
      note: wasChancellor ? 'ex-chancellor' : 'ex-president',
      reason: `term-limited — was ${wasChancellor ? 'Chancellor' : 'President'} in the last government`,
      seat: wasChancellor ? 'chancellor' : 'president'
    });
  }

  ineligible.set(state.draft.presidentId, {
    note: 'is President',
    reason: 'the President cannot nominate himself',
    seat: 'president'
  });

  return ineligible;
}

/** Derived from the rounds themselves so the draft never has to be handed an analysis. */
function getDeadPlayerIds(): ReadonlySet<string> {
  return new Set(
    state.rounds
      .map((round) => round.executionTargetId)
      .filter((id): id is string => id !== undefined)
  );
}

/*
 * Start from what he claimed — but only if the board does not already refute it. Assuming a hand
 * that could not have produced the enacted policy makes every later round impossible, so a claim
 * the table has already disproved is recorded and then assumed nothing about.
 */
function getDefaultAssumption(): readonly number[] | undefined {
  const claim = state.draft.presidentClaim;
  const enacted = state.draft.enacted;

  if (claim === undefined || enacted === undefined || !canEnactFromClaimedDraw(claim, enacted)) {
    return undefined;
  }

  return [claim];
}

function getDefaultName(index: number): string {
  return `Player ${String(index + 1)}`;
}

// ---------- entry ----------

/** A seat with no name typed shows its number rather than becoming an unlabelled button. */
function getDiscardButtonTitle(isLocked: boolean, isMissing: boolean, hasNoChoice: boolean): string {
  if (isLocked) {
    return 'ask him what he drew first';
  }

  if (isMissing) {
    return 'he says he was not holding one';
  }

  return hasNoChoice ? 'his own claim already says which card went' : '';
}

function getDisplayName(index: number): string {
  const typed = state.players[index]?.name.trim() ?? '';

  return typed === '' ? getDefaultName(index) : typed;
}

/*
 * Derived, not assumed. Votes are mandatory, so the app knows whether the government actually
 * formed — and a rejected one enacts nothing, advances the tracker, and eventually hands the
 * decision to the populace.
 *
 * Three states, not two. Before everyone has voted the outcome is not "rejected", it is simply not
 * known yet, and saying otherwise announces a result while the table is still voting.
 */
function getDraftOutcome(): 'elected' | 'pending' | 'rejected' {
  if (state.draft.isVoteConfirmed !== true || !isVoteComplete()) {
    return 'pending';
  }

  const living = getLivingPlayers();
  const jaCount = living.filter((player) => state.draft.votes[player.id] === true).length;

  return isElected(jaCount, living.length) ? 'elected' : 'rejected';
}

function getDraftRound(): Round {
  const peek = state.draft.peek.filter((policy): policy is Policy => policy !== undefined);
  const wasElected = isDraftElected();
  const isVetoed = wasElected && state.draft.isVetoed === true;

  return {
    chancellorClaim: state.draft.chancellorClaim,
    chancellorId: state.draft.chancellorId,
    enacted: isVetoed ? undefined : state.draft.enacted,
    executionTargetId: state.draft.executionTargetId,

    /*
     * Chaos is reachable from a vetoed government too, because a veto advances the tracker exactly
     * as a rejection does. So the top card is recorded for a rejected round and for a vetoed one.
     */
    forcedEnactment: wasElected && !isVetoed ? undefined : state.draft.forcedEnactment,
    hitlerCheckAnswer: state.draft.hitlerCheckAnswer,
    investigation: state.draft.investigationTargetId === undefined
      ? undefined
      : { reported: state.draft.investigationReported, targetId: state.draft.investigationTargetId },
    isVetoed: isVetoed ? true : undefined,
    peek: peek.length === DRAW_SIZE ? peek : undefined,
    presidentClaim: state.draft.presidentClaim,
    presidentDiscard: state.draft.presidentDiscard,
    presidentId: state.draft.presidentId,
    specialElectionTargetId: state.draft.specialElectionTargetId,
    votes: state.draft.votes,
    wasElected
  };
}

/**
 * Whether this round is the one that throws the country into chaos.
 *
 * The tracker counts inactive governments, and both a rejection and a veto are inactive, so this
 * reads the same for either — one more and the populace enacts the top card itself.
 */
/** Whether the session has an outcome yet — a policy on the table, or a veto. */
/** Whether a claimed hand could have contained the card the President says he discarded. */
/**
 * The discard his claim and the law on the table leave as the only possibility.
 *
 * Two ways a choice disappears, and this covers both:
 *
 * - His hand had only one colour in it. FFF and LLL leave nothing to decide whatever is on the
 *   table.
 * - The board rules the other option out. Claiming FFL under a Liberal law means he cannot have
 *   discarded the Liberal, because that leaves FF and FF cannot produce a Liberal. FLL under a
 *   Fascist law is the same shape reversed.
 *
 * When the board rules out *everything* his hand allows, his account is already refuted; the hand
 * constraint alone is used so that the contradiction is stated rather than hidden behind a blank.
 */
function getImpliedDiscard(claim: number | undefined, enacted: Policy | undefined): Policy | undefined {
  if (claim === undefined) {
    return undefined;
  }

  const holdable = [Policy.Fascist, Policy.Liberal].filter((policy) => isDiscardPossible(claim, policy));
  const consistent = holdable.filter((policy) => {
    const passed = getClaimedPassFascistCount(claim, policy);

    return enacted === undefined || passed === undefined || canEnactFromClaimedPass(passed, enacted);
  });

  const options = consistent.length > 0 ? consistent : holdable;

  return options.length === 1 ? options[0] : undefined;
}

function getLieSubject(actor: 'chancellor' | 'president' | 'unknown', view: ReadoutView): string {
  if (actor === 'unknown') {
    return 'One of them is';
  }

  const playerId = actor === 'president' ? view.presidentId : view.chancellorId;
  const name = playerId === undefined ? undefined : nameOf(playerId);
  const role = actor === 'president' ? 'The President' : 'The Chancellor';

  return name === undefined || name === '—' ? `${role} is` : `${name} (${role.toLowerCase()}) is`;
}

function getLivingPlayers(): Player[] {
  const deadIds = getDeadPlayerIds();

  return state.players.filter((player) => !deadIds.has(player.id));
}

function getPolicyClassName(value: Policy | undefined): string {
  if (value === undefined) {
    return '';
  }

  return value === Policy.Fascist ? 'is-fascist' : 'is-liberal';
}

function getPowerTargetIneligibility(
  playerId: string,
  selfId: string | undefined,
  deadIds: ReadonlySet<string>
): string | undefined {
  if (deadIds.has(playerId)) {
    return 'dead';
  }

  return playerId === selfId ? 'the President cannot pick himself' : undefined;
}

/** The dead hold no office, but the Presidency itself is never term-limited — even by a Special Election. */
function getPresidentIneligibility(analysis: GameAnalysis): ReadonlyMap<string, Ineligibility> {
  const ineligible = new Map<string, Ineligibility>();

  for (const playerId of analysis.deadPlayerIds) {
    ineligible.set(playerId, { note: 'killed', reason: 'executed — may not hold office' });
  }

  return ineligible;
}

/*
 * A recorded round is reviewed exactly as it was analysed in place, deck and all — not re-run
 * against today's deck — so tapping through the history shows what was known at the time.
 */
function getReadoutView(committedAnalysis: GameAnalysis): ReadoutView | undefined {
  const selected = state.selectedRoundIndex;

  if (selected !== undefined) {
    const analysis = committedAnalysis.rounds[selected];
    const round = state.rounds[selected];

    if (!analysis || !round) {
      return undefined;
    }

    return {
      analysis,
      chancellorClaim: round.chancellorClaim,
      chancellorId: round.chancellorId,
      deckAfter: analysis.deckAfter,
      deckBefore: analysis.deckBefore,
      enacted: round.enacted,
      isRecorded: true,
      peek: round.peek,
      presidentClaim: round.presidentClaim,
      presidentId: round.presidentId,
      roundNumber: selected + 1
    };
  }

  const draftRound = getDraftRound();
  const preview: Game = { players: state.players, rounds: [...state.rounds, draftRound] };
  const analysis = analyseGame(preview).rounds.at(-1);

  if (!analysis) {
    return undefined;
  }

  return {
    analysis,
    chancellorClaim: state.draft.chancellorClaim,
    chancellorId: state.draft.chancellorId,
    deckAfter: analysis.deckAfter,
    deckBefore: committedAnalysis.deckAfter,
    enacted: state.draft.enacted,
    isRecorded: false,
    peek: draftRound.peek,
    presidentClaim: state.draft.presidentClaim,
    presidentId: state.draft.presidentId,
    roundNumber: state.rounds.length + 1
  };
}

function getRoundMark(isFlagged: boolean, isWeird: boolean): string | undefined {
  if (isFlagged) {
    return 'conflict';
  }

  return isWeird ? 'weird' : undefined;
}

function getSeatLetter(round: Round, playerId: string): string | undefined {
  if (round.presidentId === playerId) {
    return 'P';
  }

  return round.chancellorId === playerId ? 'C' : undefined;
}

function getTokenClassName(word: string): string {
  if (word === 'President' || word === 'Presidency') {
    return 'is-president';
  }

  if (word === 'Chancellor') {
    return 'is-chancellor';
  }

  if (word === 'Fascist') {
    return 'is-fascist';
  }

  return word === 'Liberal' ? 'is-liberal' : '';
}

function getVoteButtonTitle(isDead: boolean, isLocked: boolean): string {
  if (isDead) {
    return 'executed — may not vote';
  }

  return isLocked ? 'pick the Chancellor first' : '';
}

/*
 * Who voted which way is the other half of the record, and it was being collected and then never
 * shown. Marks in seat order keep it narrow enough for the strip; the full names sit in the title
 * for anyone who needs to check a specific seat.
 */
function getVoteMark(vote: boolean | undefined): string {
  if (vote === undefined) {
    return '·';
  }

  return vote ? '\u2713' : '\u2717';
}

function getVoteWord(vote: boolean | undefined): string {
  if (vote === undefined) {
    return '—';
  }

  return vote ? 'ja' : 'nein';
}

/** `undefined` means no assumption, which is every hand still on the table. */
function isAssumed(assumed: readonly number[] | undefined, fascistCount: number): boolean {
  return assumed === undefined || assumed.includes(fascistCount);
}

// ---------- readout ----------

function isChaosImminent(analysis: GameAnalysis): boolean {
  return (analysis.rounds.at(-1)?.electionTracker ?? 0) + 1 >= ELECTION_TRACKER_LIMIT;
}

/** Still carrying the name it was born with, whether that was left alone or typed back in. */
function isDefaultName(index: number): boolean {
  const name = (state.players[index]?.name ?? '').trim();

  return name === '' || name === getDefaultName(index);
}

function isDiscardPossible(claim: number | undefined, discard: Policy | undefined): boolean {
  if (claim === undefined || discard === undefined) {
    return true;
  }

  return discard === Policy.Fascist ? claim > 0 : claim < DRAW_SIZE;
}

function isDraftElected(): boolean {
  return getDraftOutcome() === 'elected';
}

function isHand(part: string): boolean {
  return /^[FL]{2,3}$/.test(part);
}

/**
 * Whether the Chancellor just answered that he is Hitler.
 *
 * Only meaningful inside the Hitler zone, which is the only place the question is asked — outside it
 * the field is not rendered, so the answer cannot be set.
 */
function isHitlerElected(): boolean {
  return state.draft.hitlerCheckAnswer === 'yes';
}

function isSessionResolved(): boolean {
  return state.draft.enacted !== undefined || state.draft.isVetoed === true;
}

function isVoteComplete(): boolean {
  return getLivingPlayers().every((player) => state.draft.votes[player.id] !== undefined);
}

function nameOf(playerId: string | undefined): string {
  if (playerId === undefined) {
    return '—';
  }

  const index = state.players.findIndex((candidate) => candidate.id === playerId);

  return index === -1 ? '—' : getDisplayName(index);
}

/*
 * The id is deliberately left alone. Recorded rounds reference players by id, so renaming someone
 * mid-game must not orphan the history.
 */
function renamePlayer(index: number, value: string): void {
  const player = state.players[index];

  if (!player) {
    return;
  }

  state.players[index] = { id: player.id, name: value };
}

function render(): void {
  if (!(appRoot instanceof HTMLElement)) {
    return;
  }

  if (state.phase === 'setup') {
    const scrollPositions = captureScrollPositions(appRoot);

    clear(appRoot);
    appRoot.append(renderSetup());
    restoreScrollPositions(appRoot, scrollPositions);

    return;
  }

  const committed: Game = { players: state.players, rounds: state.rounds };
  const committedAnalysis = analyseGame(committed);

  /*
   * The Presidency is derived, never picked: it rotates clockwise, and a Special Election redirects
   * it. Leaving it selectable only invited it to drift out of step with the rotation.
   */
  state.draft.presidentId = committedAnalysis.nextPresidentId;

  const view = getReadoutView(committedAnalysis);

  /*
   * Shown while the vote is still open — where the odds inform it, behind the table's agreement —
   * and once a government has formed, where the claims are scored. A rejected government never
   * reaches the deck and a decided game draws no more cards, so neither shows anything. Reviewing a
   * recorded round always shows it.
   */
  const isReviewing = state.selectedRoundIndex !== undefined;
  const outcome = getDraftOutcome();
  const showReadout = state.isAnalysisVisible
    && (isReviewing || (!committedAnalysis.victory && (outcome === 'elected' || outcome === 'pending')));

  const scrollPositions = captureScrollPositions(appRoot);

  clear(appRoot);
  appRoot.append(
    renderBoard(committedAnalysis),
    ...renderPlayersBar(committedAnalysis),
    ...renderVictory(committedAnalysis),
    element('div', { className: 'main' }, [
      ...(committedAnalysis.victory ? [] : [renderEntry(committedAnalysis)]),
      ...(showReadout ? [renderReadout(view)] : [])
    ]),
    ...(state.isHistoryOpen ? [renderHistory(committedAnalysis)] : [])
  );

  restoreScrollPositions(appRoot, scrollPositions);
}

/*
 * The switch itself. Named for what it gives rather than for its state, so a table that has never
 * seen it can tell what tapping it will do.
 */
function renderAnalysisToggle(): HTMLElement {
  return element('button', {
    onClick: () => {
      state.isAnalysisVisible = !state.isAnalysisVisible;

      if (!state.isAnalysisVisible) {
        state.isHistoryOpen = false;
        state.inspectedPlayerId = undefined;
        state.selectedRoundIndex = undefined;
      }

      render();
    },
    pressed: state.isAnalysisVisible,
    text: 'Analysis',
    title: state.isAnalysisVisible
      ? 'hide the history and the odds again'
      : 'let the app remember and calculate — everyone sees the same thing'
  });
}

function renderAssumption(index: number, round: Round): HTMLElement {
  const selectable = descendingCounts(DRAW_SIZE)
    .filter((fascistCount) => round.enacted === undefined || canProduceEnacted(fascistCount, round.enacted));

  const toggles = selectable.map((fascistCount) =>
    element('button', {
      /*
       * The toggles start with every consistent hand switched on, so "selected" says nothing about
       * what he said — and with three of them lit there was no way to tell his claim from the
       * default. The claimed one is underlined in his own colour, which survives the pressed state
       * and costs no layout.
       */
      className: fascistCount === round.presidentClaim ? 'pin hand is-claimed' : 'pin hand',
      onClick: () => {
        state.rounds[index] = {
          ...round,
          assumedDrawFascistCounts: toggleAssumption(round.assumedDrawFascistCounts, fascistCount, selectable)
        };
        render();
      },
      pressed: isAssumed(round.assumedDrawFascistCounts, fascistCount),
      title: fascistCount === round.presidentClaim ? 'what the President claimed' : ''
    }, renderHand(fascistCount, DRAW_SIZE))
  );

  /*
   * The claim is named on its own line above the toggles, in the President's colour.
   *
   * It has to be stated rather than left to the marker: the toggles start with every consistent hand
   * switched on, so a lit strip is the resting state and says nothing about what was claimed, and a
   * round where nobody claimed anything looked exactly like one whose marker had been missed. It
   * says "President" rather than "he" because the line sits under a row naming two men.
   */
  const claimLine = element('div', { className: 'history__claim-line' }, [
    element('span', { className: 'history__assume-label is-president', text: 'President\'s claim' }),
    ...(round.presidentClaim === undefined
      ? [element('span', { className: 'claim__value claim__unknown', text: '?'.repeat(DRAW_SIZE) })]
      : [element('span', { className: 'claim__value' }, renderHand(round.presidentClaim, DRAW_SIZE))])
  ]);

  return element('div', { className: 'history__assume-group' }, [
    claimLine,
    element('div', { className: 'history__assume' }, [
      element('span', { className: 'history__assume-label', text: 'assume' }),
      ...toggles
    ])
  ]);
}

/*
 * One toggle per hand, per recorded draw, starting from what that President claimed. Together the
 * strip is a walkable version of the owner's conditional tree: the selection fixes what is assumed
 * about that round, the deck is recomputed forward, and the current round's odds move accordingly.
 *
 * A set rather than a single choice, because narrowing without committing is a real state of
 * knowledge — "it was FFL or FLL" — and switching off just the claimed hand is how you say you do
 * not believe him.
 */
/*
 * The toggles assume what a President drew, so they only mean anything where a draw happened.
 *
 * A rejected government never reaches the deck, and one that ends the game by electing Hitler never
 * gets as far as drawing either. Offering "assume he drew FFL" for those rounds invites the table to
 * narrow a hand that was never dealt.
 */
function renderAssumptionRow(index: number, round: Round, isSettled: boolean): HTMLElement[] {
  if (!round.wasElected || (round.enacted === undefined && round.isVetoed !== true)) {
    return [];
  }

  return [
    isSettled
      ? element('div', { className: 'history__assume-label', text: 'settled' })
      : renderAssumption(index, round)
  ];
}

function renderBoard(analysis: GameAnalysis): HTMLElement {
  const tracker = analysis.rounds.at(-1)?.electionTracker ?? 0;

  return element('header', { className: 'board' }, [
    /*
     * No title during play. The header carries two tracks, the election tracker and three buttons,
     * and the name is the one thing there that tells nobody anything — it had been squeezed to a
     * single letter and an ellipsis. It survives on the setup screen and in the browser tab.
     */
    renderTrack('Liberal laws', analysis.enactedLiberalCount, LIBERAL_TRACK_LENGTH, 'pip--liberal'),
    renderTrack('Fascist laws', analysis.enactedFascistCount, FASCIST_TRACK_LENGTH, 'pip--fascist'),
    renderTrack('Tracker', tracker, ELECTION_TRACKER_LIMIT, 'pip--tracker'),
    renderAnalysisToggle(),
    ...(state.isAnalysisVisible ? [renderHistoryButton()] : []),
    renderNewGame()
  ]);
}

function renderChancellorClaimField(): HTMLElement {
  const isLocked = !isSessionResolved();

  const buttons = descendingCounts(PASS_SIZE).map((fascistCount) =>
    element('button', {
      className: 'hand',
      disabled: isLocked,
      onClick: () => {
        state.draft.chancellorClaim = state.draft.chancellorClaim === fascistCount ? undefined : fascistCount;
        render();
      },
      pressed: state.draft.chancellorClaim === fascistCount,
      title: isLocked ? 'record the outcome first' : ''
    }, renderHand(fascistCount, PASS_SIZE))
  );

  return element('div', { className: 'field field--optional' }, [
    element('span', { className: 'field__label is-chancellor', text: 'Chancellor claims received laws' }),
    ...buttons,
    ...renderChancellorDiscard()
  ]);
}

/*
 * The Chancellor's half of the same bookkeeping, and it is stated rather than asked: he holds two
 * and plays one face up, so his claimed pair and the board between them already name the card he
 * threw away. A button row here could only ever offer the answer that is already known.
 */
function renderChancellorDiscard(): HTMLElement[] {
  if (state.draft.isVetoed === true) {
    return [element('span', { className: 'deck__note' }, renderPhrase('vetoed — he discarded both laws'))];
  }

  const discarded = getChancellorDiscard(state.draft.chancellorClaim, state.draft.enacted);

  if (discarded === undefined) {
    return [];
  }

  return [element(
    'span',
    { className: 'deck__note' },
    renderPhrase(
      `so he discarded the ${discarded === Policy.Fascist ? 'Fascist' : 'Liberal'} law`
    )
  )];
}

function renderClaimFields(): HTMLElement[] {
  return [renderChancellorClaimField(), renderPresidentClaimField(), renderPresidentDiscardField()];
}

/*
 * The Chancellor is asked first, at every player count.
 *
 * Two facts about who can be caught, which turn out to decide it:
 *
 * - The President knows exactly which pair he passed, so ANY false claim by the Chancellor is
 *   detected by him. The Chancellor has no safe lie at all.
 * - The Chancellor knows only the pair he received, so he can catch the President only if the
 *   claimed hand fails to contain that pair. Since a claimed hand is the pair plus one card, the
 *   President always has exactly one undetectable lie available: claim he discarded the other colour.
 *
 * Neither of those depends on who speaks first, which is why the Hitler-leak worry does not favour
 * President-first the way it first appears. At seven or more, where Hitler does not know his team,
 * a Fascist Chancellor who lies outs himself to a Hitler President either way — and a Fascist
 * President with a Hitler Chancellor stays safe either way, as long as he picks his one safe lie.
 * Reordering moves nothing.
 *
 * What the order does control is information transfer, and that runs one way only. The President
 * speaking first hands over the discard — something the Chancellor genuinely did not know. The
 * Chancellor speaking first tells the President nothing he did not already have. So asking the
 * Chancellor first is strictly less leaky, and it makes the President's claim a test of the
 * Chancellor's rather than a script for it.
 */
/*
 * The two accounts side by side, in their own colours.
 *
 * Reading them apart is the whole job of the row, and a single string made the reader work out
 * which half was whose every time. The President's is followed by what he says he discarded, because
 * that is what turns his hand into a statement about the pair the Chancellor received — and so what
 * makes the two halves directly comparable.
 */
function renderClaims(round: Round): HTMLElement[] {
  const passed = getClaimedPassFascistCount(round.presidentClaim, round.presidentDiscard);
  const chancellorDiscard = round.isVetoed === true ? undefined : getChancellorDiscard(round.chancellorClaim, round.enacted);

  /*
   * Each account is tagged with its seat.
   *
   * The letters themselves are coloured by policy now, which is what makes a hand readable at a
   * glance but also means the colour no longer says whose claim it is. A slash between the two left
   * the reader counting cards to work out where one account ended. The tag says it outright.
   */
  return [
    element('span', { className: 'claim__tag is-president', text: 'P' }),
    element(
      'span',
      { className: 'claim__value' },
      round.presidentClaim === undefined
        ? [element('span', { className: 'claim__unknown', text: '?'.repeat(DRAW_SIZE) })]
        : renderHand(round.presidentClaim, DRAW_SIZE)
    ),
    ...(round.presidentDiscard === undefined
      ? []
      : [element('span', { className: 'claim__aside', text: `\u2212${round.presidentDiscard}` })]),
    ...(passed === undefined
      ? []
      : [
        element('span', { className: 'claim__aside', text: '=' }),
        element('span', { className: 'claim__value' }, renderHand(passed, PASS_SIZE))
      ]),
    element('span', { className: 'claim__tag is-chancellor', text: 'C' }),
    element(
      'span',
      { className: 'claim__value' },
      round.chancellorClaim === undefined
        ? [element('span', { className: 'claim__unknown', text: '?'.repeat(PASS_SIZE) })]
        : renderHand(round.chancellorClaim, PASS_SIZE)
    ),
    ...(chancellorDiscard === undefined
      ? []
      : [element('span', { className: 'claim__aside', text: `\u2212${chancellorDiscard}` })])
  ];
}

/*
 * The three fields that feed the engine come first — enacted policy, then the two claims. Everything
 * below them is history and can be filled in during a lull, so a live table never waits on it.
 */
/*
 * The button says what is still needed rather than just refusing. A disabled control with no
 * explanation is the fastest way to lose someone mid-game.
 */
/*
 * Sits in the flow with the other rows rather than pinned to the bottom, so it reads as the last
 * step of the form instead of a separate action bar — the same shape as `vote done`.
 */
function renderCommitField(analysis: GameAnalysis): HTMLElement {
  const missing = describeMissingFields(analysis);

  return element('div', { className: 'field' }, [
    element('span', { className: 'field__label', text: 'Round' }),
    element('button', {
      className: 'pin',
      disabled: missing !== undefined,
      onClick: () => {
        commitRound();
        render();
      },
      text: 'save round'
    }),
    element('span', {
      className: missing === undefined ? 'entry__ready' : 'entry__missing'
    }, renderPhrase(missing ?? 'ready'))
  ]);
}

/*
 * "14 cards, composition uncertain" says almost nothing. The pile is only ever a handful of
 * compositions, and naming them with their weights is both shorter to read and far more useful —
 * "9F 5L or 10F 4L" is something you can act on.
 */
/** `11F 6L`, each half in its own colour. */
function renderComposition(fascistCount: number, liberalCount: number): HTMLElement[] {
  return [
    element('span', { className: 'is-fascist', text: `${String(fascistCount)}F` }),
    element('span', { text: ' ' }),
    element('span', { className: 'is-liberal', text: `${String(liberalCount)}L` })
  ];
}

function renderDeck(deck: DeckState): HTMLElement {
  const exact = getExactFascistCount(deck);

  if (exact !== null) {
    return element('div', { className: 'deck' }, [
      element('span', { className: 'deck__count' }, renderComposition(exact, deck.size - exact)),
      element('span', { className: 'deck__note deck__note--exact', text: 'known exactly' })
    ]);
  }

  const possibilities = [...deck.fascistCountProbabilities.entries()]
    .filter(([, probability]) => probability > 0)
    .sort(([, a], [, b]) => b - a);

  const chips = possibilities.map(([fascistCount, probability]) =>
    element('span', { className: 'deck__option' }, [
      element('span', { className: 'deck__composition' }, renderComposition(fascistCount, deck.size - fascistCount)),
      element('span', { className: 'deck__weight', text: formatPercentage(probability) })
    ])
  );

  return element('div', { className: 'deck' }, [
    element('span', { className: 'deck__count', text: `${String(deck.size)} cards` }),
    element('div', { className: 'deck__options' }, chips)
  ]);
}

function renderDossier(playerId: string, analysis: GameAnalysis): HTMLElement {
  const index = state.players.findIndex((player) => player.id === playerId);
  const lines: HTMLElement[] = [];

  if (analysis.confirmedNotHitler.includes(playerId)) {
    lines.push(element('div', { className: 'dossier__proof', text: '\u2713 confirmed not Hitler' }));
  }

  const killedIn = state.rounds.findIndex((round) => round.executionTargetId === playerId);

  if (killedIn !== -1) {
    const killer = nameOf(state.rounds[killedIn]?.presidentId);
    lines.push(element('div', {
      className: 'dossier__dead',
      text: `\u2620 killed by ${killer} in round ${String(killedIn + 1)}`
    }));
  }

  /*
   * Above this line are facts a player can see by looking at the table: the Hitler check was
   * answered out loud, and a dead man is visibly out. Below it is the app's memory of what was said
   * and done, which is the part the switch governs.
   */
  if (state.isAnalysisVisible) {
    const governments = state.rounds
      .map((round, roundIndex) => renderGovernmentLine(round, roundIndex, playerId))
      .filter((entry): entry is HTMLElement => entry !== undefined);

    if (governments.length === 0) {
      lines.push(element('div', { text: 'No governments yet' }));
    } else {
      lines.push(...governments);
    }

    lines.push(...renderDossierClaims(playerId));
  }

  return element('div', { className: 'dossier' }, [
    renderDossierHeader(playerId, index),
    ...lines
  ]);
}

function renderDossierClaims(playerId: string): HTMLElement[] {
  const lines: HTMLElement[] = [];

  for (const [roundIndex, round] of state.rounds.entries()) {
    const investigation = round.investigation;

    if (investigation?.targetId !== playerId) {
      continue;
    }

    const reported = investigation.reported;
    const said = reported === undefined
      ? 'said nothing'
      : `said ${reported === Policy.Fascist ? 'Fascist' : 'Liberal'} party`;

    lines.push(element('div', {
      className: 'dossier__claim',
      text: `Investigated by ${nameOf(round.presidentId)} in round ${String(roundIndex + 1)}, ${said}`
    }));
  }

  return lines;
}

/** What others reported about this player, kept as claims rather than facts. */
/*
 * The name is plain text until you ask to change it. A field that is always live invites a keyboard
 * on a tablet every time somebody opens a dossier just to read it.
 */
function renderDossierHeader(playerId: string, index: number): HTMLElement {
  const isRenaming = state.renamingPlayerId === playerId;

  const nameNode = isRenaming
    ? textInput({
      className: 'dossier__rename',
      label: `Name for ${getDisplayName(index)}`,
      maxLength: MAX_NAME_LENGTH,
      onInput: (value) => {
        renamePlayer(index, value);
      },
      value: state.players[index]?.name ?? ''
    })
    : element('span', { className: 'dossier__name', text: getDisplayName(index) });

  return element('div', { className: 'dossier__header' }, [
    nameNode,
    ...(isDefaultName(index) && !isRenaming
      ? [element('span', { className: 'deck__note', text: 'default name' })]
      : []),
    element('button', {
      className: 'pin',
      onClick: () => {
        state.renamingPlayerId = isRenaming ? undefined : playerId;
        render();
      },
      pressed: isRenaming,
      text: isRenaming ? 'done' : 'Rename'
    }),
    element('button', {
      className: 'pin',
      onClick: () => {
        state.inspectedPlayerId = undefined;
        state.renamingPlayerId = undefined;
        render();
      },
      text: 'close'
    })
  ]);
}

/*
 * The difference between the two columns is the whole honesty of the tool, so the page states it
 * rather than assuming the reader already knows what the headers mean.
 */
/*
 * The draw odds depend on the pile and nothing else — not on claims, not on what was enacted. They
 * are the one thing worth knowing *before* voting on a government, so they are always on screen,
 * even before a round has been entered.
 */
/*
 * Two columns, equal weight, both honest readings of the same worlds. `shuffle` quantifies only the
 * shuffle and leaves the President's choice of which card to discard unmodelled; `uniform` treats every
 * unforced choice as a coin flip. They agree wherever no choice exists — which is exactly where the
 * answer needs no assumption at all.
 */
/*
 * The same draw, now narrowed by what the table actually saw. The enacted policy rules out hands
 * that could not have produced it — an enacted Fascist makes LLL impossible — and the remaining
 * weights are the shuffle's, renormalised. No assumption is made about which card anyone discarded.
 */
/*
 * The second of the two tables, and the difference between them is the whole point.
 *
 * The one above is the draw before anyone knows anything. This one is the same question asked again
 * after the enacted policy is face up — a public fact, which rules a hand out entirely (no Fascist
 * comes from LLL) and re-weights the rest.
 *
 * The heading does not spell that conditioning out. It said "given the Fascist" first, which was
 * conditional-probability notation written in English, then "now that a Fascist is on the table",
 * which was merely long: the enacted policy is a button two rows up and nobody needs reminding it
 * is there.
 */
function renderDrawTable(view: ReadoutView): HTMLElement {
  const rows = descendingCounts(DRAW_SIZE).map((fascistCount) =>
    element('tr', { className: fascistCount === view.presidentClaim ? 'is-claimed' : '' }, [
      element('td', {}, renderHand(fascistCount, DRAW_SIZE)),
      element('td', { text: formatPercentage(view.analysis.shuffle.drawProbabilities[fascistCount] ?? 0) })
    ])
  );

  return element('div', { className: 'claim' }, [
    element('div', { className: 'claim__title' }, [
      element('span', { className: 'is-president', text: 'President claims ' }),
      ...renderHand(view.presidentClaim ?? 0, DRAW_SIZE),
      element('span', { className: 'is-president', text: ' — what he really held:' })
    ]),
    element('table', {}, [
      element('thead', {}, [
        element('tr', {}, [
          element('th', { text: 'Hand' }),
          element('th', { text: 'Chance' })
        ])
      ]),
      element('tbody', {}, rows)
    ])
  ]);
}

function renderEntry(analysis: GameAnalysis): HTMLElement {
  /*
   * The fields scroll if a ten-seat game overflows a short screen; the button never does. Losing the
   * primary action off the bottom edge is worse than a scrollbar nobody usually needs.
   */
  /*
   * Ordered the way the round actually happens: nominate, vote, and only then the legislative
   * session. Everything down to the enacted policy is mandatory; the two claims are not, because a
   * government is free to say nothing.
   */
  const outcome = getDraftOutcome();
  const fields = element('div', { className: 'entry__fields' }, [
    renderPresidentField(),
    renderSeatField('Chancellor', 'chancellorId', getChancellorIneligibility(analysis)),
    renderVotesField(),
    ...renderPowerPlayWarning(analysis),
    // Nothing downstream of the vote exists until the vote is in.
    /*
     * In the order the round actually happens. The Hitler question is asked the moment the
     * government forms, before anyone draws, so it comes before the policy — and the claims are
     * about a session that has not happened until a policy is on the table.
     */
    ...(outcome === 'elected' ? renderHitlerCheck(analysis) : []),

    /*
     * Electing Hitler in the zone ends the game where it stands. The rules are explicit that he must
     * say so, and the Fascists win on the answer — the government never gets as far as drawing, so
     * there is no policy, no claims and no power to record, and asking for them would invent a
     * legislative session that never happened.
     */
    ...(outcome === 'elected' && !isHitlerElected()
      ? [
        renderPolicyField(analysis),
        ...renderClaimFields(),
        ...renderPower(analysis),
        // A veto is an inactive government, so it can be the one that hands the decision over.
        ...(state.draft.isVetoed === true && isChaosImminent(analysis) ? [renderForcedEnactmentField()] : [])
      ]
      : []),
    ...(outcome === 'rejected' ? renderRejectedFields(analysis) : []),
    renderCommitField(analysis)
  ]);

  return element('section', { className: 'panel panel--entry' }, [
    element('h2', {
      className: 'panel__heading',
      text: `Round ${String(state.rounds.length + 1)}${outcome === 'rejected' ? ' — rejected' : ''}`
    }),
    fields
  ]);
}

/*
 * If the executed player is Hitler he must reveal himself, and the game ends there. That makes this
 * answer a fact rather than a claim, which is why it ends the game outright.
 */
function renderExecution(deadIds: ReadonlySet<string>): HTMLElement[] {
  const fields = [renderPowerTarget('Execute', 'executionTargetId', deadIds)];

  if (state.draft.executionTargetId === undefined) {
    return fields;
  }

  const answers = [
    { label: 'not Hitler', value: false },
    { label: 'WAS HITLER', value: true }
  ];

  return [
    ...fields,
    element('div', { className: 'field field--power' }, [
      element('span', { className: 'field__label', text: 'Revealed' }),
      ...answers.map((answer) =>
        element('button', {
          className: answer.value ? 'is-fascist' : '',
          onClick: () => {
            state.draft.wasExecutedPlayerHitler = state.draft.wasExecutedPlayerHitler === answer.value
              ? undefined
              : answer.value;
            render();
          },
          pressed: state.draft.wasExecutedPlayerHitler === answer.value,
          text: answer.label
        })
      )
    ])
  ];
}

/*
 * The card the frustrated populace turns over. Shared by the two ways of getting there: a third
 * rejected government, and a veto that pushes the tracker to the same limit.
 */
function renderForcedEnactmentField(): HTMLElement {
  const buttons = [Policy.Liberal, Policy.Fascist].map((policy) =>
    element('button', {
      className: policy === Policy.Fascist ? 'is-fascist' : 'is-liberal',
      onClick: () => {
        state.draft.forcedEnactment = state.draft.forcedEnactment === policy ? undefined : policy;
        render();
      },
      pressed: state.draft.forcedEnactment === policy,
      text: policy === Policy.Fascist ? 'Fascist' : 'Liberal'
    })
  );

  return element('div', { className: 'field field--power' }, [
    element('span', { className: 'field__label', text: 'Off the top' }),
    ...buttons
  ]);
}

/*
 * One line per government the player sat in, spelled out: which seat, which round, what came of it.
 * The compact `#3 P→F` fitted the history strip, where every row has the same shape and the reader
 * is scanning; a dossier is read one line at a time and can afford the words.
 */
function renderGovernmentLine(round: Round, roundIndex: number, playerId: string): HTMLElement | undefined {
  const seat = getSeatLetter(round, playerId);

  if (seat === undefined || !round.wasElected) {
    return undefined;
  }

  const isPresident = seat === 'P';

  return element('div', {}, [
    element('span', {
      className: isPresident ? 'is-president' : 'is-chancellor',
      text: isPresident ? 'President' : 'Chancellor'
    }),
    element('span', { text: ` #${String(roundIndex + 1)} \u2192 ` }),
    ...renderRoundOutcome(round)
  ]);
}

/*
 * A hand, one span per card, so each letter carries its own colour.
 *
 * Built from the count rather than by splitting the formatted string: the same convention as
 * `formatHand`, Fascists first, and it keeps the letters typed as policies instead of characters.
 */
function renderHand(fascistCount: number, size: number): HTMLElement[] {
  return Array.from(
    { length: size },
    (_unused, index) => (index < fascistCount ? Policy.Fascist : Policy.Liberal)
  ).map((policy) => element('span', { className: getPolicyClassName(policy), text: policy }));
}

/** The same, for a hand that arrived as text — a token matched inside a sentence. */
function renderHandText(hand: string): HTMLElement[] {
  return renderHand((hand.match(/F/g) ?? []).length, hand.length);
}

function renderHistory(analysis: GameAnalysis): HTMLElement {
  if (state.rounds.length === 0) {
    return element('div', { className: 'overlay' }, [
      element('button', {
        className: 'overlay__scrim',
        onClick: () => {
          closeHistory();
          render();
        }
      }),
      element('div', { className: 'overlay__panel' }, [
        element('span', { className: 'empty', text: 'No rounds recorded yet.' })
      ])
    ]);
  }

  const cards = state.rounds.map((round, index) => {
    const roundAnalysis = analysis.rounds[index];
    /*
     * Two marks, and the difference is what kind of trouble it is.
     *
     * CONFLICT — the claim collides with something already known: with the other seat's claim, or
     * with the board itself. A Chancellor claiming LL under a Fascist policy is the second kind, and
     * it is a proof rather than a suspicion, so it gets the same weight as a mutual contradiction.
     *
     * WEIRD — nothing is contradicted; the story simply requires a choice nobody makes. FFL then FF
     * (he discarded the Liberal) and FL then F (he enacted the Fascist) are both legal and both never
     * happen in a normal game.
     */
    const isFlagged = (roundAnalysis?.lies.length ?? 0) > 0
      || roundAnalysis?.shuffle.isPossible === false
      || roundAnalysis?.peekContradiction === true;
    const isWeird = (roundAnalysis?.unusualPlays.length ?? 0) > 0;
    const isSelected = state.selectedRoundIndex === index;
    const mark = getRoundMark(isFlagged, isWeird);

    /*
     * Only the summary selects the round. The pins sit outside it, so tapping "trust" changes the
     * assumption without also yanking the readout away to a different round.
     */
    const summary = element('button', {
      className: 'history__summary',
      onClick: () => {
        /*
         * Picking a round is a request to look at it, and the readout is underneath the overlay, so
         * choosing one closes the history. The assumption toggles below sit outside this button and
         * leave it open, because narrowing several rounds in a row is one continuous job.
         */
        state.selectedRoundIndex = isSelected ? undefined : index;
        closeHistory();
        render();
      },
      pressed: isSelected
    }, [
      element('div', { className: 'history__index', text: `#${String(index + 1)}` }),
      renderHistorySeats(round),
      element('div', { className: 'history__claims' }, [
        ...renderClaims(round),
        ...(mark === undefined ? [] : [element('span', { className: `mark mark--${mark}`, text: mark })])
      ]),
      ...renderHistoryVotes(round),
      ...renderHistoryPower(round)
    ]);

    /*
     * Only the current shuffle cycle can be reasoned about. A reshuffle rebuilds the pile from the
     * discard pile, so everything before it is settled — no assumption there can move a number here,
     * and offering toggles that do nothing would be a lie about what the tool can tell you.
     */
    const isSettled = index < analysis.currentCycleStartIndex;

    const card = element('div', {
      className: [
        'history__round',
        isFlagged ? 'history__round--flagged' : '',
        isWeird && !isFlagged ? 'history__round--weird' : '',
        isSelected ? 'history__round--selected' : '',
        isSettled ? 'history__round--settled' : '',
        index === state.rounds.length - 1 ? 'history__round--latest' : ''
      ].filter(Boolean).join(' ')
    }, [
      summary,
      ...renderAssumptionRow(index, round, isSettled)
    ]);

    // Mark where the pile was rebuilt, since that is where the reasoning starts over.
    if (analysis.rounds[index]?.didReshuffle === true) {
      return element('div', { className: 'history__group' }, [
        card,
        element('div', { className: 'history__divider', text: 'reshuffle' })
      ]);
    }

    return card;
  });

  return element('div', { className: 'overlay' }, [
    element('button', {
      className: 'overlay__scrim',
      onClick: () => {
        closeHistory();
        render();
      }
    }),
    element('div', { className: 'overlay__panel history' }, [
      element('div', { className: 'field' }, [
        element('h2', { className: 'panel__heading', text: 'History' }),
        element('button', {
          className: 'pin',
          onClick: () => {
            closeHistory();
            render();
          },
          text: 'close'
        })
      ]),
      element('div', {
        className: 'history__legend',
        text: 'CONFLICT means the record contradicts a public fact or the other seat. WEIRD breaks no rule but optimal play would never have produced it. Tap a round to review it; the toggles assume what that President really drew, starting at his claim. Rounds before a reshuffle are settled — the pile is rebuilt there, so nothing earlier can change them.'
      }),
      element('div', { className: 'history__cards' }, cards)
    ])
  ]);
}

function renderHistoryButton(): HTMLElement {
  const count = state.rounds.length;

  return element('button', {
    disabled: count === 0,
    onClick: () => {
      state.isHistoryOpen = true;
      render();
    },
    pressed: state.isHistoryOpen,
    text: `History ${String(count)}`,
    title: count === 0 ? 'nothing recorded yet' : 'every round so far'
  });
}

/** What the President did with the power, so the history is a record of actions and not just cards. */
function renderHistoryPower(round: Round): HTMLElement[] {
  const notes: string[] = [];

  if (round.executionTargetId !== undefined) {
    notes.push(`killed ${nameOf(round.executionTargetId)}`);
  }

  if (round.investigation) {
    const reported = round.investigation.reported;
    const said = reported === undefined
      ? 'said nothing'
      : `said ${reported === Policy.Fascist ? 'Fascist' : 'Liberal'} party`;
    notes.push(`investigated ${nameOf(round.investigation.targetId)}, ${said}`);
  }

  if (round.specialElectionTargetId !== undefined) {
    notes.push(`picked ${nameOf(round.specialElectionTargetId)}`);
  }

  if (round.peek) {
    notes.push(`peeked ${round.peek.join('')}`);
  }

  if (round.hitlerCheckAnswer === 'no') {
    notes.push(`${nameOf(round.chancellorId)} not Hitler`);
  }

  if (round.hitlerCheckAnswer === 'yes') {
    notes.push(`${nameOf(round.chancellorId)} IS HITLER`);
  }

  return notes.map((note) => element('div', { className: 'history__power', text: note }));
}

/** Who governed and what came of it, in the two seat colours. */
function renderHistorySeats(round: Round): HTMLElement {
  return element('div', { className: 'history__seats' }, [
    element('span', { className: 'is-president', text: seatLabelOf(round.presidentId) }),
    element('span', { className: 'claim__aside', text: '/' }),
    element('span', { className: 'is-chancellor', text: seatLabelOf(round.chancellorId) }),
    element('span', { text: ' → ' }),
    ...renderRoundOutcomeMark(round)
  ]);
}

function renderHistoryVotes(round: Round): HTMLElement[] {
  const votes = round.votes;

  if (!votes || Object.keys(votes).length === 0) {
    return [];
  }

  const marks = state.players.map((player) => getVoteMark(votes[player.id])).join('');

  const jaCount = state.players.filter((player) => votes[player.id] === true).length;
  const neinCount = state.players.filter((player) => votes[player.id] === false).length;

  const detail = state.players
    .map((player, index) => `${getDisplayName(index)} ${getVoteWord(votes[player.id])}`)
    .join(', ');

  return [element('div', {
    className: 'history__votes',
    text: `${marks}  ${String(jaCount)}\u2013${String(neinCount)}`,
    title: detail
  })];
}

// ---------- history ----------

/*
 * The Hitler check is the one statement the rules force to be truthful, so surviving it is proof
 * rather than testimony. It only means anything inside the zone, so it only appears there.
 */
function renderHitlerCheck(analysis: GameAnalysis): HTMLElement[] {
  if (analysis.enactedFascistCount < HITLER_ZONE_THRESHOLD || state.draft.chancellorId === undefined) {
    return [];
  }

  const answers = [
    { label: 'not Hitler', value: 'no' },
    { label: 'IS HITLER', value: 'yes' }
  ] as const;

  return [element('div', { className: 'field field--power' }, [
    element('span', { className: 'field__label', text: 'Is Hitler?' }),
    ...answers.map((answer) =>
      element('button', {
        className: answer.value === 'yes' ? 'is-fascist' : '',
        onClick: () => {
          state.draft.hitlerCheckAnswer = state.draft.hitlerCheckAnswer === answer.value ? undefined : answer.value;
          render();
        },
        pressed: state.draft.hitlerCheckAnswer === answer.value,
        text: answer.label
      })
    )
  ])];
}

/*
 * Why a seat is struck through, spelled out rather than hidden in a tooltip.
 *
 * A crossed-out button on a screen being passed around a table raises the question every time, and
 * a tooltip does not exist on touch. It sits on its own line instead of inside the buttons, because
 * putting it there would resize the tap targets and move every seat after it.
 */
function renderIneligibilityNotes(ineligible: ReadonlyMap<string, Ineligibility>): HTMLElement[] {
  const notes = state.players
    .map((player, index) => {
      const entry = ineligible.get(player.id);

      return entry === undefined
        ? undefined
        : element('span', { className: getActorClassName(entry.seat ?? 'unknown'), text: `${seatLabel(index)} ${entry.note}` });
    })
    .filter((note): note is HTMLElement => note !== undefined);

  if (notes.length === 0) {
    return [];
  }

  // Interleaved separators rather than a joined string, so each note keeps its own colour.
  const parts = notes.flatMap((note, index) => index === 0 ? [note] : [element('span', { className: 'claim__aside', text: '\u00b7' }), note]);

  return [element('span', { className: 'deck__note' }, parts)];
}

/*
 * The President sees a Party Membership card and may then say anything he likes about it, so both
 * the target and what he reported are recorded — the report as a claim, not as a fact.
 */
function renderInvestigation(deadIds: ReadonlySet<string>): HTMLElement[] {
  /*
   * A Party Membership card, which is not a law and not quite a role either: Hitler's party card
   * reads Fascist, so an investigation that comes back Fascist has not distinguished him from an
   * ordinary Fascist. Saying "party" keeps that from being read as either of the other two.
   */
  const reports = [
    { label: 'said Liberal party', policy: Policy.Liberal },
    { label: 'said Fascist party', policy: Policy.Fascist }
  ];

  return [
    renderPowerTarget('Investigate', 'investigationTargetId', deadIds),
    element('div', { className: 'field field--power' }, [
      element('span', { className: 'field__label', text: 'Reported party' }),
      ...reports.map((report) =>
        element('button', {
          className: report.policy === Policy.Fascist ? 'is-fascist' : 'is-liberal',
          onClick: () => {
            state.draft.investigationReported = state.draft.investigationReported === report.policy
              ? undefined
              : report.policy;
            render();
          },
          pressed: state.draft.investigationReported === report.policy,
          text: report.label
        })
      )
    ])
  ];
}

/*
 * Legal, but nobody plays it that way. Kept visually distinct from a contradiction: a contradiction
 * proves someone lied, whereas this only says the story requires an odd choice — which is a reason
 * to ask a question at the table, not a reason to believe anything in particular.
 */
/*
 * Names the liar when the record names him. The enacted policy is a public fact, so a claim that
 * could not have produced it is refuted outright — that is a proof about one player, and saying
 * "one of these two" instead would throw the proof away.
 */
function renderLies(view: ReadoutView): HTMLElement[] {
  return view.analysis.lies.map((lie) => {
    const subject = getLieSubject(lie.actor, view);

    return element('p', { className: 'alert' }, [
      element('strong', { className: getActorClassName(lie.actor), text: `${subject} lying` }),
      element('span', {}, renderPhrase(` — ${lie.description}`))
    ]);
  });
}

/*
 * Everything publicly known about one player, in the order it matters: what is *proved* about them
 * first, then what they have done in government, then what others have said about them.
 */
/*
 * Arrows rather than dragging: the deployment is a shared tablet, and HTML5 drag-and-drop does not
 * fire on touch at all. One tap per position is also easier to aim at than a drag on a screen being
 * passed between people.
 */
function renderMoveButton(index: number, direction: number): HTMLElement {
  const target = index + direction;
  const isPossible = target >= 0 && target < state.players.length;

  return element('button', {
    className: 'move',
    disabled: !isPossible,
    onClick: () => {
      swapPlayers(index, target);
      render();
    },
    text: direction < 0 ? '\u25c0' : '\u25b6',
    title: isPossible ? 'move seat' : ''
  });
}

function renderNewGame(): HTMLElement {
  return element('button', {
    onClick: () => {
      // Back to setup with the same people; only the game itself is discarded.
      state.phase = 'setup';
      state.rounds = [];
      state.draft = createDraft();
      state.inspectedPlayerId = undefined;
      state.renamingPlayerId = undefined;
      state.selectedRoundIndex = undefined;
      render();
    },
    text: 'New game'
  });
}

/*
 * The odds, and the table's decision to look at them.
 *
 * Hidden by default and revealed by a tap that everyone sees. That is the whole mechanism: the
 * numbers help a Fascist judge whether a lie is safe, but he cannot consult them quietly — he has to
 * ask the table to turn them over, in front of the people he is lying to, and wanting to look is
 * itself worth something to the others. Revealed, everyone reads the same thing.
 *
 * They are phrased as the three decisions they actually inform, rather than as a ranking of hands.
 * A hand ranking is read backwards by a liar picking a story; a decision is not.
 */
function renderOdds(): HTMLElement[] {
  const deck = analyseGame({ players: state.players, rounds: state.rounds }).deckAfter;
  const distribution = getDrawDistribution(deck);
  const fascistOnTop = getTopCardFascistProbability(deck);

  const lines = [
    { label: 'A government you trust enacts a Liberal law', value: 1 - (distribution[DRAW_SIZE] ?? 0) },
    {
      label: 'A Fascist President could force a Fascist law',
      value: (distribution[DRAW_SIZE] ?? 0) + (distribution[DRAW_SIZE - 1] ?? 0)
    },
    { label: 'Letting the vote fail turns up a Liberal law', value: 1 - fascistOnTop }
  ];

  return [
    element(
      'div',
      { className: 'claim' },
      lines.map((line) =>
        element('div', { className: 'field' }, [
          element('span', {}, renderPhrase(line.label)),
          element('span', { className: 'claim__value', text: formatPercentage(line.value) })
        ])
      )
    )
  ];
}

function renderPassClaim(view: ReadoutView): HTMLElement {
  return element('div', { className: 'claim' }, [
    element('div', { className: 'claim__title' }, [
      element('span', { className: 'is-chancellor', text: 'Chancellor claims ' }),
      ...renderHand(view.chancellorClaim ?? 0, PASS_SIZE)
    ]),
    element('div', { className: 'field' }, [
      renderVerdict(view.analysis.shuffle.chancellorClaim),
      element('span', { className: 'deck__note' }, renderPhrase(describeBounds(view.analysis.shuffle.chancellorClaim, view)))
    ])
  ]);
}

function renderPeek(): HTMLElement[] {
  const slots = Array.from({ length: DRAW_SIZE }, (_unused, slot) => {
    const value = state.draft.peek[slot];

    return element('button', {
      className: getPolicyClassName(value),
      onClick: () => {
        state.draft.peek[slot] = cyclePolicy(value);
        render();
      },
      pressed: value !== undefined,
      text: value ?? '?'
    });
  });

  return [element('div', { className: 'field field--power' }, [
    element('span', { className: 'field__label', text: 'Peek says' }),
    ...slots
  ])];
}

/*
 * A Policy Peek is a claim like any other and gets scored like one.
 *
 * It looks at the pile *after* this round's three cards are gone, which is why it reads `deckAfter`.
 *
 * One number, and it is the ordered one. He sees the top three in sequence and reports them in that
 * sequence, so the sequence is the claim; how likely the same three cards were in some other order
 * is not a question anyone at the table is asking. (That figure is the ordered one times `C(3, k)`,
 * if it is ever wanted again.)
 */
function renderPeekClaim(view: ReadoutView): HTMLElement[] {
  const peek = view.peek;

  if (peek?.length !== DRAW_SIZE) {
    return [];
  }

  const fascistCount = peek.filter((policy) => policy === Policy.Fascist).length;

  // One line: with nothing to contrast it against, the figure needs no label saying which one it is.
  return [element('div', { className: 'claim' }, [
    element('div', { className: 'claim__title is-president' }, [
      element('span', { text: 'President peeked ' }),
      ...peek.map((policy) => element('span', { className: getPolicyClassName(policy), text: policy })),
      element('span', { text: ' ' }),
      element('span', { className: 'claim__value', text: formatPercentage(getOrderedDrawProbability(view.deckAfter, fascistCount)) })
    ])
  ])];
}

/*
 * Colours the seat words inside a sentence.
 *
 * The two colours are only useful if they are everywhere — a coloured label above a plain "Pick the
 * Chancellor" teaches the reader that the colour means nothing in particular. Doing it by word means
 * every message written from here on is coloured without anyone having to remember to do it.
 */
function renderPhrase(text: string): HTMLElement[] {
  return text
    .split(COLOURED_TOKEN_PATTERN)
    .filter((part) => part !== '')
    .flatMap((part) => isHand(part) ? renderHandText(part) : [element('span', { className: getTokenClassName(part), text: part })]);
}

/*
 * Once the game is decided nothing further can be recorded — the entry panel is gone entirely, not
 * merely disabled, because there is no such thing as a round after the win.
 */
/*
 * A tap rather than a hover, because the deployment is a television or a tablet and neither has a
 * pointer. The chip carries the two durable facts as glyphs so the bar is scannable without opening
 * anything; the dossier holds the rest.
 */
function renderPlayersBar(analysis: GameAnalysis): HTMLElement[] {
  const deadIds = new Set(analysis.deadPlayerIds);
  const clearedIds = new Set(analysis.confirmedNotHitler);

  // Reordering belongs to setup; by the time this bar is on screen the seating is settled.
  const chips = state.players.map((player, index) => {
    const marks = [clearedIds.has(player.id) ? '\u2713' : '', deadIds.has(player.id) ? '\u2620' : ''].join('');

    return element('button', {
      className: deadIds.has(player.id) ? 'chip chip--dead' : 'chip',
      onClick: () => {
        state.inspectedPlayerId = state.inspectedPlayerId === player.id ? undefined : player.id;
        state.renamingPlayerId = undefined;
        render();
      },
      pressed: state.inspectedPlayerId === player.id,
      text: `${seatLabel(index)}: ${getDisplayName(index)}${marks === '' ? '' : ` ${marks}`}`
    });
  });

  const bar = element('div', { className: 'players' }, [
    element('span', { className: 'track__label', text: 'Players' }),
    ...chips
  ]);

  const inspected = state.inspectedPlayerId;

  if (inspected === undefined) {
    return [bar];
  }

  return [bar, renderDossier(inspected, analysis)];
}

function renderPolicyField(analysis: GameAnalysis): HTMLElement {
  const buttons = [Policy.Liberal, Policy.Fascist].map((policy) =>
    element('button', {
      className: policy === Policy.Fascist ? 'is-fascist' : 'is-liberal',
      onClick: () => {
        const wasImplied = getImpliedDiscard(state.draft.presidentClaim, state.draft.enacted) !== undefined;

        state.draft.enacted = state.draft.enacted === policy ? undefined : policy;
        state.draft.isVetoed = undefined;

        // The law on the table is half of what implies the discard, so changing it re-runs the sum.
        syncImpliedDiscard(wasImplied);
        render();
      },
      pressed: state.draft.enacted === policy && state.draft.isVetoed !== true,
      text: policy === Policy.Fascist ? 'Fascist' : 'Liberal'
    })
  );

  /*
   * The Veto Power is permanent once the fifth Fascist policy is up, and it is the government's
   * outcome rather than a policy — so it belongs in this row as a third answer to "what came of the
   * session", not as a separate control somewhere below.
   */
  if (analysis.enactedFascistCount >= VETO_THRESHOLD) {
    buttons.push(element('button', {
      onClick: () => {
        const wasImplied = getImpliedDiscard(state.draft.presidentClaim, state.draft.enacted) !== undefined;

        state.draft.isVetoed = state.draft.isVetoed === true ? undefined : true;

        if (state.draft.isVetoed === true) {
          // A veto plays nothing face up, so any law already tapped is no longer the outcome.
          state.draft.enacted = undefined;
        }

        // With no law on the table there is nothing to imply the discard from, so it is withdrawn.
        syncImpliedDiscard(wasImplied);
        render();
      },
      pressed: state.draft.isVetoed === true,
      text: 'Vetoed',
      title: 'both laws discarded, nothing enacted, and the tracker advances'
    }));
  }

  return element('div', { className: 'field' }, [
    element('span', { className: 'field__label', text: 'Law enacted' }),
    ...buttons
  ]);
}

/*
 * Which power fires is fixed by the player count and by how many Fascist policies are up once this
 * one lands, so the control appears on its own rather than being hunted for.
 */
function renderPower(analysis: GameAnalysis): HTMLElement[] {
  if (state.draft.enacted !== Policy.Fascist) {
    return [];
  }

  const power = getPowerForFascistPolicy(state.players.length, analysis.enactedFascistCount + 1);
  const deadIds = new Set(analysis.deadPlayerIds);

  switch (power) {
    case 'execution':
      return renderExecution(deadIds);
    case 'investigateLoyalty':
      return renderInvestigation(deadIds);
    case 'policyPeek':
      return renderPeek();
    case 'specialElection':
      return [renderPowerTarget('Next President', 'specialElectionTargetId', deadIds)];
    default:
      return [];
  }
}

/*
 * A "power play": nominating as Chancellor the very player who is due the Presidency next. It is
 * legal and sometimes deliberate, but it hands one player both seats back to back and burns the
 * rotation, so it is worth saying out loud before the vote rather than after.
 */
function renderPowerPlayWarning(analysis: GameAnalysis): HTMLElement[] {
  const presidentId = state.draft.presidentId;
  const chancellorId = state.draft.chancellorId;

  if (presidentId === undefined || chancellorId === undefined) {
    return [];
  }

  const successorId = getSuccessorId({
    afterPlayerId: presidentId,
    deadPlayerIds: analysis.deadPlayerIds,
    players: state.players
  });

  if (successorId !== chancellorId) {
    return [];
  }

  return [element('p', { className: 'weird' }, [
    element('span', { className: 'weird__badge', text: 'Power play' }),
    element('span', {}, renderPhrase(` ${nameOf(chancellorId)} is next in line for the Presidency — nominating him as Chancellor gives him both seats in a row`))
  ])];
}

function renderPowerTarget(
  label: string,
  key: 'executionTargetId' | 'investigationTargetId' | 'specialElectionTargetId',
  deadIds: ReadonlySet<string>
): HTMLElement {
  /*
   * No power may be aimed at the man holding it. A Special Election is rulebook-explicit — the
   * President chooses "any other player at the table" — and the table's ruling extends the same to
   * executing and to investigating himself, neither of which the rulebook spells out.
   */
  const selfId = state.draft.presidentId;

  const buttons = state.players.map((player, index) => {
    const reason = getPowerTargetIneligibility(player.id, selfId, deadIds);

    return element('button', {
      className: reason === undefined ? '' : 'is-ineligible',
      disabled: reason !== undefined,
      onClick: () => {
        state.draft[key] = state.draft[key] === player.id ? undefined : player.id;
        render();
      },
      pressed: state.draft[key] === player.id,
      text: seatLabel(index),
      title: describeSeat(index, reason)
    });
  });

  return element('div', { className: 'field field--power' }, [
    element('span', { className: 'field__label', text: label }),
    ...buttons
  ]);
}

function renderPresidentClaimField(): HTMLElement {
  // Nothing can be said about a session until its outcome is known.
  const isLocked = !isSessionResolved();

  const buttons = descendingCounts(DRAW_SIZE).map((fascistCount) =>
    element('button', {
      className: 'hand',
      disabled: isLocked,
      onClick: () => {
        const wasImplied = getImpliedDiscard(state.draft.presidentClaim, state.draft.enacted) !== undefined;

        state.draft.presidentClaim = state.draft.presidentClaim === fascistCount ? undefined : fascistCount;
        syncImpliedDiscard(wasImplied);
        render();
      },
      pressed: state.draft.presidentClaim === fascistCount,
      title: isLocked ? 'record the outcome first' : ''
    }, renderHand(fascistCount, DRAW_SIZE))
  );

  return element('div', { className: 'field field--optional' }, [
    element('span', { className: 'field__label is-president', text: 'President claims received laws' }),
    ...buttons
  ]);
}

/*
 * The other half of the President's account, and the half that makes it testable.
 *
 * What he drew does not say what the Chancellor received — only what he discarded does. Ask both and
 * the two men are describing the same two cards, so a Chancellor who invents a pair contradicts a
 * statement the President has already made rather than quietly rewriting it.
 */
function renderPresidentDiscardField(): HTMLElement {
  const claim = state.draft.presidentClaim;
  const isLocked = claim === undefined;

  /*
   * The row is dead when only one answer can be recorded at all — which is not the same test as
   * "the answer is implied", and the difference is the whole of it.
   *
   * FFL under a Liberal law implies he discarded the Fascist, but "I discarded the Liberal" is still
   * a statement a man can make: it means he passed FF, it contradicts the board, and the readout
   * says so. Two representable answers, so both stay live.
   *
   * FFF implies the same way and does not leave a second answer. "I discarded a Liberal" is not a
   * rival claim, it is an incoherent one — he says he was holding none — and it cannot even be
   * represented, since `formatHand` throws on a three-Fascist pass out of two cards. That leaves the
   * one live button able to do exactly one thing: clear the answer to "he has not said", a state
   * that cannot exist, because claiming FFF is itself saying which card went.
   */
  const representable = [Policy.Liberal, Policy.Fascist].filter((policy) => isDiscardPossible(claim, policy));
  const hasNoChoice = !isLocked && representable.length <= 1;

  const buttons = [Policy.Liberal, Policy.Fascist].map((policy) => {
    // He cannot discard a colour he says he never held, so LLL offers no Fascist and FFF no Liberal.
    const isMissing = !isLocked && !isDiscardPossible(claim, policy);

    return element('button', {
      className: policy === Policy.Fascist ? 'is-fascist' : 'is-liberal',
      disabled: isLocked || isMissing || hasNoChoice,
      onClick: () => {
        state.draft.presidentDiscard = state.draft.presidentDiscard === policy ? undefined : policy;
        render();
      },
      pressed: state.draft.presidentDiscard === policy,
      text: policy === Policy.Fascist ? 'Fascist' : 'Liberal',
      title: getDiscardButtonTitle(isLocked, isMissing, hasNoChoice)
    });
  });

  const passed = getClaimedPassFascistCount(claim, state.draft.presidentDiscard);

  return element('div', { className: 'field field--optional' }, [
    element('span', { className: 'field__label is-president', text: 'President claims discarded law' }),
    ...buttons,
    ...(passed === undefined
      ? []
      : [element('span', { className: 'deck__note' }, [
        element('span', { text: 'so he says he passed ' }),
        ...renderHand(passed, PASS_SIZE)
      ])])
  ]);
}

/** Read-only: the rotation decides this, so it is reported rather than offered. */
function renderPresidentField(): HTMLElement {
  return element('div', { className: 'field' }, [
    element('span', { className: 'field__label is-president', text: 'President' }),
    element('span', { className: 'seat is-president', text: nameOf(state.draft.presidentId) })
  ]);
}

function renderReadout(view: ReadoutView | undefined): HTMLElement {
  const isRecorded = view?.isRecorded === true;
  const heading = view && isRecorded ? `Round ${String(view.roundNumber)} — recorded` : 'What the shuffle says';
  const backButton = isRecorded
    ? [element('button', {
      className: 'pin',
      onClick: () => {
        state.selectedRoundIndex = undefined;
        render();
      },
      text: 'back to current'
    })]
    : [];

  const deck = view?.deckBefore ?? { fascistCountProbabilities: [], size: 0 };
  const panel = element('section', { className: 'panel panel--readout' }, [
    element('div', { className: 'field' }, [
      element('h2', { className: 'panel__heading', text: heading }),
      ...backButton
    ]),
    renderDeck(deck)
  ]);

  if (view !== undefined && !view.isRecorded && getDraftOutcome() === 'pending') {
    panel.append(...renderOdds());

    return panel;
  }

  if (!view?.enacted) {
    /*
     * No forecast of the draw is shown, deliberately.
     *
     * It would rank the hands before anyone has spoken, and nobody honest takes a decision from
     * that: the President is looking at his actual cards, the Chancellor at his, and the vote is
     * already over. The one player it helps is a Fascist choosing what to claim, who reads off that
     * a hand is unlikely and quietly avoids the lie that would have caught him. Leaving him to guess
     * is the risk that makes lying cost something, and the improbable claim he then makes is exactly
     * what the Liberals are meant to catch.
     *
     * The pile's composition above stays: it is plain bookkeeping the table could do itself, and
     * every later number is read against it.
     */
    panel.append(element('p', {
      className: 'empty',
      text: 'Record what the government did, and this will say what the shuffle makes of it.'
    }));

    return panel;
  }

  panel.append(...renderLies(view));

  if (!view.analysis.shuffle.isPossible) {
    panel.append(element('p', { className: 'alert', text: 'This record is impossible against the deck.' }));
  }

  panel.append(...renderUnusualPlays(view.analysis.unusualPlays));

  if (view.presidentClaim !== undefined) {
    panel.append(renderDrawTable(view));
  }

  if (view.chancellorClaim !== undefined) {
    panel.append(renderPassClaim(view));
  }

  panel.append(...renderPeekClaim(view));

  return panel;
}

function renderRejectedFields(analysis: GameAnalysis): HTMLElement[] {
  if (!isChaosImminent(analysis)) {
    return [element('div', { className: 'field' }, [
      element('span', { className: 'field__label', text: 'Outcome' }),
      element('span', { className: 'deck__note', text: 'rejected — the tracker advances' })
    ])];
  }

  return [renderForcedEnactmentField()];
}

/** What the government produced: a policy in its own colour, a veto, or nothing recorded yet. */
function renderRoundOutcome(round: Round): HTMLElement[] {
  if (round.isVetoed === true) {
    return [element('span', { text: 'vetoed' })];
  }

  if (round.enacted === undefined) {
    return [element('span', { className: 'deck__note', text: 'nothing recorded' })];
  }

  return [
    element('span', {
      className: getPolicyClassName(round.enacted),
      text: round.enacted === Policy.Fascist ? 'Fascist' : 'Liberal'
    }),
    element('span', { text: ' law' })
  ];
}

/** The outcome as a single glyph, in its policy colour. */
function renderRoundOutcomeMark(round: Round): HTMLElement[] {
  if (round.isVetoed === true) {
    return [element('span', { text: 'veto' })];
  }

  if (round.enacted === undefined) {
    return [element('span', { text: '—' })];
  }

  return [element('span', { className: getPolicyClassName(round.enacted), text: round.enacted })];
}

function renderSeatField(
  label: string,
  key: 'chancellorId' | 'presidentId',
  ineligible: ReadonlyMap<string, Ineligibility>
): HTMLElement {
  const buttons = state.players.map((player, index) => {
    const reason = ineligible.get(player.id)?.reason;

    return element('button', {
      className: reason === undefined ? '' : 'is-ineligible',
      disabled: reason !== undefined,
      onClick: () => {
        state.draft[key] = state.draft[key] === player.id ? undefined : player.id;
        render();
      },
      pressed: state.draft[key] === player.id,
      text: seatLabel(index),
      title: describeSeat(index, reason)
    });
  });

  return element('div', { className: 'field field--optional' }, [
    element('span', { className: `field__label is-${key === 'presidentId' ? 'president' : 'chancellor'}`, text: label }),
    ...buttons,
    ...renderIneligibilityNotes(ineligible)
  ]);
}

/*
 * Everything that has to be true before the first nomination, and nothing that changes after it.
 * Seat count, who is sitting where, and what they are called.
 */
function renderSetup(): HTMLElement {
  const counts = Array.from(
    { length: MAX_PLAYER_COUNT - MIN_PLAYER_COUNT + 1 },
    (_unused, index) => MIN_PLAYER_COUNT + index
  );

  const seatButtons = counts.map((count) =>
    element('button', {
      onClick: () => {
        setPlayerCount(count);
        render();
      },
      pressed: state.players.length === count,
      text: String(count)
    })
  );

  const seats = state.players.map((player, index) =>
    element('div', { className: 'setup__seat' }, [
      element('span', { className: 'setup__index', text: seatLabel(index) }),
      textInput({
        className: 'setup__name',
        label: `Name for ${seatLabel(index)}`,
        maxLength: MAX_NAME_LENGTH,
        onInput: (value) => {
          renamePlayer(index, value);
        },
        value: player.name
      }),
      renderMoveButton(index, -1),
      renderMoveButton(index, 1)
    ])
  );

  return element('section', { className: 'setup' }, [
    element('h1', { className: 'board__title', text: 'Secret Hitler Companion' }),
    element('div', { className: 'field' }, [
      element('span', { className: 'field__label', text: 'Seats' }),
      ...seatButtons
    ]),
    element('p', {
      className: 'deck__note',
      text: 'Seat them in the order they are sitting — the Presidency rotates that way. Names are optional.'
    }),
    element('div', { className: 'setup__seats' }, seats),
    element('button', {
      className: 'button--wide',
      onClick: () => {
        state.phase = 'playing';
        state.rounds = [];
        state.draft = createDraft();
        render();
      },
      text: 'Start game'
    })
  ]);
}

function renderTrack(label: string, filled: number, length: number, modifier: string): HTMLElement {
  const pips = Array.from({ length }, (_unused, index) => element('span', { className: index < filled ? `pip ${modifier}` : 'pip' }));

  return element('div', { className: 'track' }, [
    element('span', { className: 'track__label', text: label }),
    ...pips
  ]);
}

function renderUnusualPlays(plays: readonly UnusualPlay[]): HTMLElement[] {
  return plays.map((play) =>
    element('p', { className: 'weird' }, [
      element('span', { className: 'weird__badge', text: 'Weird' }),
      element('span', {
        className: getActorClassName(play.actor),
        text: ` ${play.actor === 'president' ? 'President' : 'Chancellor'}`
      }),
      element('span', {}, renderPhrase(` ${play.description}`))
    ])
  );
}

function renderVerdict(assessment: ClaimAssessment | undefined): HTMLElement {
  const verdict = assessment?.verdict ?? 'possible';

  return element('span', { className: `verdict verdict--${verdict}`, text: verdict });
}

function renderVictory(analysis: GameAnalysis): HTMLElement[] {
  const victory = analysis.victory;

  if (!victory) {
    return [];
  }

  return [
    element('div', { className: `victory victory--${victory.team}` }, [
      element('strong', { text: `${victory.team === 'fascist' ? 'Fascist' : 'Liberal'} team won` }),
      element('span', { text: ` ${victory.reason}` })
    ]),
    /*
     * Nothing else is left on the page: the form is gone and the odds describe a draw that will not
     * happen. Reviewing what was said is the only thing anyone wants now, so the page says where it
     * is rather than ending in an empty expanse.
     */
    element('p', { className: 'empty', text: 'Open History to go back over the game.' })
  ];
}

function renderVotesField(): HTMLElement {
  const deadIds = getDeadPlayerIds();
  // The round happens in a fixed order, so the form follows it: no votes before a nomination.
  const isLocked = state.draft.chancellorId === undefined;

  const buttons = state.players.map((player, index) => {
    const vote = state.draft.votes[player.id];
    const label = seatLabel(index);
    // The executed "may not speak, vote, or run for office".
    const isDead = deadIds.has(player.id);

    /*
     * The mark lives in its own fixed-width slot rather than being appended to the label. The tick
     * and cross come from a fallback font with different metrics, so concatenating them grew the
     * button and shifted every seat after it — moving the targets out from under whoever was
     * tapping down the row.
     */
    return element('button', {
      className: isDead ? 'vote is-ineligible' : 'vote',
      disabled: isDead || isLocked,
      onClick: () => {
        cycleVote(player.id);
        render();
      },
      pressed: vote === true,
      title: describeSeat(index, getVoteButtonTitle(isDead, isLocked) || undefined)
    }, [
      element('span', { text: label }),
      element('span', { className: 'vote__mark', text: getVoteMark(vote) })
    ]);
  });

  const living = getLivingPlayers();
  const jaCount = living.filter((player) => state.draft.votes[player.id] === true).length;
  const neinCount = living.filter((player) => state.draft.votes[player.id] === false).length;
  const isComplete = isVoteComplete();
  const isConfirmed = state.draft.isVoteConfirmed === true;

  return element('div', { className: 'field' }, [
    element('span', { className: 'field__label', text: 'Votes for the government' }),
    ...buttons,
    element('span', {
      className: 'deck__note',
      text: `${String(jaCount)} ja · ${String(neinCount)} nein`
    }),
    element('button', {
      className: 'pin',
      disabled: !isComplete,
      onClick: () => {
        state.draft.isVoteConfirmed = !isConfirmed;
        render();
      },
      pressed: isConfirmed,
      text: isConfirmed ? 'reopen' : 'vote done'
    })
  ]);
}

function restoreScrollPositions(root: HTMLElement, positions: ReadonlyMap<string, ScrollPosition>): void {
  for (const [selector, position] of positions) {
    const node = root.querySelector(selector);

    if (node instanceof HTMLElement) {
      node.scrollTop = position.top;
      node.scrollLeft = position.left;
    }
  }
}

/*
 * In-game buttons always carry the seat, never the name.
 *
 * The seat is short, fixed-width and unique by construction, so a ten-seat row fits and the labels
 * stop moving when somebody is renamed mid-game. Names belong where there is room to read them —
 * the players bar and the dossier.
 */
function seatLabel(index: number): string {
  return `P${String(index + 1)}`;
}

// ---------- shared helpers ----------

function seatLabelOf(playerId: string | undefined): string {
  const index = state.players.findIndex((player) => player.id === playerId);

  return index === -1 ? '—' : seatLabel(index);
}

function setPlayerCount(count: number): void {
  // Keep the names already typed; only add or drop seats at the end.
  const existing = state.players.slice(0, count);
  const added = Array.from(
    { length: Math.max(0, count - existing.length) },
    (_unused, index) => createPlayer(existing.length + index)
  );

  state.players = [...existing, ...added];
  state.inspectedPlayerId = undefined;
  state.renamingPlayerId = undefined;
}

/** Moves the whole player, id included, so nothing recorded against them is orphaned. */
function swapPlayers(from: number, to: number): void {
  const first = state.players[from];
  const second = state.players[to];

  if (!first || !second) {
    return;
  }

  state.players[from] = second;
  state.players[to] = first;
  state.inspectedPlayerId = undefined;
  state.renamingPlayerId = undefined;
}

/**
 * Fills the discard in wherever it is not a choice, and withdraws one the app supplied once it stops
 * being implied.
 *
 * `wasImplied` says whether the value standing before this edit was the app's rather than the
 * President's. His own answer survives an edit; the app's does not, because correcting a mis-tapped
 * hand would otherwise leave a discard nobody said out loud sitting in his row.
 */
function syncImpliedDiscard(wasImplied: boolean): void {
  const claim = state.draft.presidentClaim;
  const implied = getImpliedDiscard(claim, state.draft.enacted);

  if (implied !== undefined) {
    state.draft.presidentDiscard = implied;

    return;
  }

  if (wasImplied || claim === undefined || !isDiscardPossible(claim, state.draft.presidentDiscard)) {
    state.draft.presidentDiscard = undefined;
  }
}

/*
 * Switching the last one off would leave no worlds at all, so it is treated as clearing the
 * assumption instead — the same place you would have to return to anyway.
 */
function toggleAssumption(
  assumed: readonly number[] | undefined,
  fascistCount: number,
  selectable: readonly number[]
): readonly number[] | undefined {
  const current = assumed ?? selectable;
  const next = current.includes(fascistCount)
    ? current.filter((count) => count !== fascistCount)
    : [...current, fascistCount];

  if (next.length === 0 || next.length === selectable.length) {
    return undefined;
  }

  return next;
}
