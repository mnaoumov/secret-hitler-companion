# Contributing

Contributions are welcome! Here's how to get started.

## Filing an issue (for AI agents and humans)

Open issues through the [issue forms](https://github.com/mnaoumov/secret-hitler-companion/issues/new/choose), not as blank issues.

Filing from the CLI or the API (`gh issue create --body`, or an AI agent filing for you) skips the form, and `gh issue create --template` cannot load an issue form. In that case, open the matching form in [`.github/ISSUE_TEMPLATE/`](https://github.com/mnaoumov/secret-hitler-companion/tree/HEAD/.github/ISSUE_TEMPLATE), copy every field as a `### <label>` heading in the form's order, and fill in each one. Always state the version you used and your operating system.

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

The commit message is also checked for identifiers that point into notes kept outside this repository,
which a reader here cannot look up. Refer to a path, a symbol, a commit hash or an issue number from this
repository's own tracker instead. The `commit-msg` hook runs the check, and CI runs it again over every
pushed range.

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
