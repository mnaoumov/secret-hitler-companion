# Secret Hitler Companion

A companion for a live, in-person game of [Secret Hitler](https://www.secrethitler.com/). Type in
what publicly happened each round; it keeps the government history and works out what the **shuffle**
says about every claim players make about cards nobody else saw.

It runs on one shared screen — cast to a television, or a tablet passed around the table.

## What it does

- **Tracks the draw pile for you.** The pile's size is always public; its composition is not, because
  every legislative session discards two unseen cards. So the deck is carried as a distribution, and
  the reshuffle collapses it back to a certainty — the rebuilt pile is exactly the full deck minus
  the face-up tracks.
- **Scores each claim against that deck.** A President claiming FFF from a fresh deck after a Fascist
  policy went up held FFF a quarter of the time — and held a Liberal he chose to discard the other three
  quarters.
- **Proves what can be proved.** Some claims are *forced* (a President who really drew FFF had no
  Liberal to discard, so his Chancellor necessarily received FF). Some are *impossible*. Some pairs of
  claims contradict each other outright, which means one of the two is lying whatever the deck held.
- **Asks the President what he discarded.** That is what makes the Chancellor answerable: the hand
  alone says nothing about the pair that changed hands, so the two seats end up describing the same
  two cards and any disagreement between them is a real one. The Chancellor's own discard needs no
  asking — he held two and one is face up on the table — so it is worked out and shown.
- **Lets you condition on a claim.** Trust or doubt any President's claim and every later round is
  recomputed against that assumption.

## What it deliberately does not do

It knows nothing about roles and holds no secret information — it only ever stores what the whole
table already heard. So it cannot tell you who is Hitler, it cannot leak anything, and it is
table-legal by construction.

It also does not guess at people. There are no behavioural priors, no "probability this player is a
fascist". Every number comes from the shuffle and from what is logically forced, and where a human
*choice* is involved that the shuffle cannot speak to, the display says so rather than inventing a
number.

## Usage

```bash
npm install
npm run dev       # builds, watches and serves on http://127.0.0.1:4173/
```

For a deployable copy, `npm run build` writes a minified static `dist/` that any static file server
can host. There is no server side and no build-time configuration: the page references its script and
stylesheet relatively, so the same `dist/` works at a domain root, under a sub-path, or opened from
disk.

## Deployment

Pushing to `main` publishes to GitHub Pages at
<https://mnaoumov.dev/secret-hitler-companion/>, but only after the full check job passes — a
site the table is reading mid-game should never be updated by a broken build.

The workflow is the `deploy` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). It needs
**Settings -> Pages -> Build and deployment -> Source: GitHub Actions** set once on the repository;
no secrets or tokens are involved.

A round is entered in the order it happens: the Chancellor is nominated, the table votes, and once
the vote is confirmed the outcome and the claims open up — the enacted policy (or a veto, once five
Fascist policies are up), then what the Chancellor says he received, then what the President says he
drew and discarded. The claims are optional; a government is free to say nothing.

## Development

See [AGENTS.md](AGENTS.md) for the model, the architecture, and the rules verification notes.

```bash
npm run test           # engine unit tests
npm run lint           # eslint
npm run format:check   # dprint
npm run build:compile  # tsc
```

## License

[MIT](LICENSE)

Secret Hitler itself is by Mike Boxleiter, Tommy Maranges and Mac Schubert, licensed
CC BY-NC-SA 4.0. This is an independent companion tool and ships none of the game's assets.
