import type { MarkdownlintCli2ConfigurationSchema } from '@mnaoumov/typescript-dev-toolkit/linters/markdownlint-types/@types/markdownlint-cli2-config-schema';

import relativeLinksRule from 'markdownlint-rule-relative-links';

export const config: MarkdownlintCli2ConfigurationSchema = {
  config: {
    'MD013': false,
    'MD024': {
      // eslint-disable-next-line camelcase -- Markdownlint config schema uses snake_case keys.
      siblings_only: true
    },
    'MD052': {
      // eslint-disable-next-line camelcase -- Markdownlint config schema uses snake_case keys.
      ignored_labels: ['!note', '!warning'],
      // eslint-disable-next-line camelcase -- Markdownlint config schema uses snake_case keys.
      shortcut_syntax: true
    },
    'relative-links': true
  },
  customRules: [
    relativeLinksRule
  ],
  globs: [
    '**/*.md'
  ],
  ignores: [
    'node_modules/**',
    '.git/**',
    'dist/**'
  ]
};
