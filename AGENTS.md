# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A companion for a live, in-person game of Secret Hitler. You type in what publicly happened each
round; the site keeps the government history and, for every claim a player makes about cards nobody
else saw, computes what the **shuffle** says about it.

It runs on one shared screen — cast to a television, or a tablet passed around the table. It holds
**only public information** and knows nothing about roles, so it cannot leak anything and is
table-legal by construction.

## Commands

| Task              | Command                 |
| ----------------- | ----------------------- |
| Run it locally    | `npm run dev`           |
| Build the site    | `npm run build`         |
| TypeScript check  | `npm run build:compile` |
| Lint              | `npm run lint`          |
| Lint (fix)        | `npm run lint:fix`      |
| Format            | `npm run format`        |
| Format (check)    | `npm run format:check`  |
| Spellcheck        | `npm run spellcheck`    |
| Markdown lint     | `npm run lint:md`       |
| Test              | `npm run test`          |
| Test (coverage)   | `npm run test:coverage` |
| Commit (wizard)   | `npm run commit`        |

`npm run dev` builds, watches and serves on <http://127.0.0.1:4173/>. `npm run build` writes a
minified static `dist/` that any static server can host.

## The model

The analysis is **combinatorics and logical consistency, and nothing else** — no roles, no
behavioural priors, no Bayesian inference over who is fascist. That was a deliberate call by the
owner, and it is what lets every number on screen be called objective.

The formulation is his: `Aᵢ` = "the i-th President told the truth about his cards", with
`P(A₂|A₁) ≠ P(A₂|A₁')` because **`A₁` determines which three cards left the draw pile**, and the
deck is what the hypergeometric indexes on.

Two consequences worth knowing before touching `src/engine/`:

- **The deck is a sufficient statistic for the whole truth-history.** Two different sequences of
  true/false claims that leave the same pile are the same state, so the `2^n` conditional tree
  collapses into one forward pass. Never materialise the tree.
- **The shuffle picks the three cards; it does not pick which one a human discards.** That gap is why
  every cell carries two readings — see below.
- **The President is asked what he discarded, not just what he drew.** His hand alone does not say
  what the Chancellor received, so without the discard the pair has to be read off the *Chancellor's*
  claim — and a lying Chancellor then silently rewrites the President's account. With both halves
  recorded the two men are describing the same two cards, so a disagreement is theirs, and the
  "discarded a Liberal while holding a Fascist" flag rests on the President's own words. Do not
  reintroduce the inference.
- **The Chancellor's discard is derived, never asked.** He holds two and plays one face up, so his
  claimed pair minus the policy on the board names it (`getChancellorDiscard`). It is displayed for
  completeness; an input would only offer the answer already known, or a self-contradiction. This is
  not symmetric with the President's for a reason: he discards one of *three*, so his is a free
  choice that nothing public pins down.

### The two discard models

| | What it quantifies | When to trust it |
| --- | --- | --- |
| `shuffle` | Only the shuffle. A world survives if *some* choice sequence fits the public record, carrying its shuffle weight unmodified. | Always. It is assumption-free. |
| `uniform` | Every unforced choice as a coin flip. | As a fallback where nothing is forced. The assumption is knowably false. |

They agree exactly where no choice exists — a drawn FFF or LLL forces the pass — and that is where
the answer needs no assumption at all. `FORCED` and `IMPOSSIBLE` verdicts are identical under both.

Under `shuffle`, hypotheses about the *passed pair* overlap (a drawn FFL is consistent with passing
either FF or FL), so they do not partition and are reported as `{ min, max }` bounds rather than a
distribution. Draw hypotheses do partition, so those stay a distribution.

### Conflict and weird

Two different findings, and conflating them would be a real error:

- **Conflict** — the record contradicts something already known: a public fact (the enacted policy
  refutes a claim, naming that seat as the liar) or the other seat's account (one of the two lied,
  and nothing says which). `findLies`.
- **Weird** — nothing is contradicted. It breaks no rule, but **optimal play would never have
  produced it**: the player took the Fascist option with a Liberal one in hand *and then said so*,
  when the covering lie — claim the hand that left you no choice — was available and free.
  `findUnusualPlays`.

Neither is scored. A conflict is a proof; a weird play is an observation.

### One switch over everything the app knows

`state.isAnalysisVisible` is **off by default** and governs the history, the deck composition, the
odds, every claim verdict, and the dossier's record of a player. What stays visible is what a player
could see by sitting at the table: the two tracks, the election tracker, who is dead, who survived
the Hitler check, and the form for recording the round. Recording is never blocked — the switch
decides what the players are told, not what is kept.

Do not quietly widen what escapes it. A verdict leaking through, say, a history badge while the
switch is off defeats the whole thing.

### Why the odds in particular are worth guarding

The deck odds are shown **only before the vote, and only when the switch above is on**. Do not
surface them once a government has formed.

The reasoning, because it is not obvious and was got wrong twice:

- They inform three real pre-vote decisions: whether a trusted pair will manage a Liberal law,
  whether a suspected President could force a Fascist one (he needs two Fascists to do it), and
  whether letting the vote fail is better than governing.
- They also tell a Fascist whether his intended lie is plausible, so he can avoid the improbable
  claim that would have exposed him. That is a real cost — the improbable claim is exactly what the
  Liberals are meant to catch.
- **No display can deny him the numbers.** Hiding them from the President and Chancellor candidates
  does not work: another Fascist reads the screen and nods. Anything shown to anyone is available to
  the Fascist team.
- What can be denied is *quiet, constant* access. Behind a switch the table has to agree to turn on,
  in front of the people he would be lying to, and wanting it on is itself information for everyone
  else.

Phrase them as decisions, never as a ranking of hands: a ranking is read backwards by a liar
choosing a story. The pile's composition (`11F 6L`) stays visible throughout, being plain bookkeeping
the table could do itself and the thing every later number is read against.

## Architecture

- **`src/engine/`** — pure TypeScript, no DOM, fully unit-tested.
  - `policy.ts` — the `Policy` type and the fixed deck composition (11F / 6L).
  - `combinatorics.ts` — exact integer `combinations` and the hypergeometric.
  - `deck.ts` — `DeckState` as a distribution over the Fascist count; reshuffle, revealed-top-card.
  - `session.ts` — the core: one legislative session as a transition, under both discard models.
  - `claims.ts` — `FORCED` / `POSSIBLE` / `IMPOSSIBLE`, who is provably lying, and the odd-but-legal
    plays. `getClaimedPassFascistCount` turns hand-plus-discard into the pair the President says he
    handed over, which is what the Chancellor's claim is compared against.
  - `rules.ts` — player-count tables: roles, powers, term limits.
  - `game.ts` — the `Round` record and the forward filter over a whole game.
  - `spreadsheet-fixture.ts` — **generated**; every row of the owner's original spreadsheet.
- **`src/ui/`** — vanilla TS, no framework. `main.ts` re-renders the whole tree on every change,
  which is cheap at this size and removes a class of state bugs.
- **`scripts/`** — npm script entry points (`jiti scripts/<name>.ts`), from `typescript-template`.

### Deck bookkeeping

The pile *size* is always publicly known (17, minus 3 per session, minus 1 per election-tracker
enactment, reset at each reshuffle). Its *composition* is not, because each session discards two
unseen cards. Hence the distribution.

**The reshuffle collapses it to a point mass.** Leftovers are shuffled back in rather than
discarded, so the rebuilt pile is exactly `17 − enacted`. Uncertainty accumulates within a shuffle
cycle and resets at the end of it; cycles run about four to five governments. The tool is at full
strength on the first government of each cycle.

## Display constraints

The person entering data and the people watching share one screen, so one layout has to be readable
from three metres *and* tappable at arm's length:

- Type scales with the viewport (`--step`), never a fixed pixel size.
- Both discard models are equal, labelled columns — never a value plus a small grey parenthetical,
  which is unreadable across a room.
- Tap-only after setup. Seat names default to callsigns so nobody has to type at all.
- The heading and the **Record round** button never scroll away; only the fields and the readout
  have a scroll fallback for short screens.

## Rules verification

Everything in `rules.ts` is checked against the official rulebook PDF and the printed Fascist Track
boards (both in `F:\Obsidian\!Unsorted\!!files\Secret Hitler\`). Points that are easy to get wrong:

- An election needs **more than 50%** — a tie fails. The placards say "at least 50%"; the rulebook
  and the tie rule are authoritative.
- Term limits: **5 players lock only the last Chancellor**; 6–10 lock the last President too. The
  `livingPlayerCount` arm of `getTermLimitedPlayers` is a common-play *interpretation*, flagged in
  the source.
- Powers are player-count dependent and are **not** in the rulebook text — they are printed on the
  boards. 5–6: Policy Peek at the 3rd F. 7–8: Investigate at the 2nd, Special Election at the 3rd.
  9–10: Investigate at the 1st and 2nd, Special Election at the 3rd. All: Execution at the 4th and
  5th, veto unlocked with the 5th.
- **The Hitler-zone check is the only statement the rules force to be truthful** ("a player who is
  Hitler must say so if assassinated or if elected Chancellor after three Fascist Policies have been
  enacted"). Surviving it is therefore *proof*, not testimony, and earns a permanent label.
- Policy Peek returns the top three **in order**, so the next draw is exactly those cards — which is
  what makes a peek claim checkable against the next President's claim.
- No player may be investigated twice in the same game.
- A **veto** discards all three cards and plays none face up. It is therefore an *inactive*
  government: it does **not** reset the election tracker (the rulebook resets that only when a tile
  is played face up, by a government or by the populace) but advances it, so a veto can be the third
  inactive government and throw the country into chaos. Grants no presidential power.
- **No presidential power may be aimed at the President himself.** A Special Election is
  rulebook-explicit ("any other player"); execution and investigation are the table's ruling, not
  the rulebook's, which says only "one player at the table" and "a player" respectively.

## Deployment

`main` publishes to GitHub Pages via the `deploy` job in `.github/workflows/ci.yml`, gated on
`needs: check` so nothing reaches the live site without the full gate passing.

Two things to preserve if the build changes:

- **Asset paths stay relative.** `src/index.html` references `app.js` and `styles.css` with no
  leading slash, which is the only reason a project page under `/secret-hitler-companion/` works
  without a base-path rewrite. An absolute path would 404 there while still working locally.
- **The artifact is `dist/`, served as-is.** Pages runs no Jekyll on an Actions-uploaded artifact, so
  no `.nojekyll` is needed and nothing is post-processed.

## Testing

`src/engine/spreadsheet-fixture.ts` is the specification for `combinatorics.ts`: all 78 deck
compositions from the owner's spreadsheet, computed there by sequential draw-without-replacement
rather than binomial coefficients, so matching it is a genuine cross-check.

The worked fixtures in `session.test.ts` were computed by hand from the 11F/6L deck **before any
code existed**. Treat them as the spec, not as regression output:

| | shuffle | uniform |
| --- | --- | --- |
| `P(drew FFF)` after an enacted F | 165/660 = 25.0% | 165/440 = 37.5% |
| `P(drew FFL)` | 50.0% | 50.0% |
| `P(drew FLL)` | 25.0% | 12.5% |
| `P(Chancellor held FF \| President drew FFF)` | 100% FORCED | 100% FORCED |
