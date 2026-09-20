# Contributing

Contributions are welcome! Here's how to get started.

## Prerequisites

- [Node.js](https://nodejs.org/) (see [`.nvmrc`](.nvmrc) for the required major version)
- npm (comes with Node.js)

## Setup

```bash
git clone https://github.com/mnaoumov/secret-hitler-companion.git
cd secret-hitler-companion
npm install
```

## Development Workflow

### Type check

```bash
npm run build:compile
```

### Commit

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Use the interactive commit prompt:

```bash
npm run commit
```

### Lint

```bash
npm run lint
npm run lint:fix
```

### Format

```bash
npm run format:check
npm run format
```

### Spellcheck

```bash
npm run spellcheck
```

### Markdown lint

```bash
npm run lint:md
npm run lint:md:fix
```

### Vendored ESLint rules

```bash
npm run check:vendored-eslint-rules
```

The rule sources under `scripts/helpers/eslint-rules/` are hand-copies of
[`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils)', and this asserts they still match
upstream after the deltas recorded in `scripts/check-vendored-eslint-rules.ts`. Do not hand-edit a copy: take
the upstream change whole, or record a new delta as a transform arm. It fetches from GitHub, so
`CHECK_VENDORED_ESLINT_RULES=0` turns it off for a run when you are offline.

### Test

```bash
npm run test
npm run test:coverage
```

## Pull Requests

- Base your PR on the `main` branch.
- Ensure all checks pass (`build:compile`, `lint`, `format:check`, `spellcheck`, `lint:md`,
  `check:vendored-eslint-rules`, `test`).
- Use [Conventional Commits](https://www.conventionalcommits.org/) for your commit messages.
