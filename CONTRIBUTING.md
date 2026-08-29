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

### Test

```bash
npm run test
npm run test:coverage
```

## Pull Requests

- Base your PR on the `main` branch.
- Ensure all checks pass (`build:compile`, `lint`, `format:check`, `spellcheck`, `lint:md`, `test`).
- Use [Conventional Commits](https://www.conventionalcommits.org/) for your commit messages.
