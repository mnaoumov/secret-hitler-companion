import type { UserConfig } from '@commitlint/types';

import { RuleConfigSeverity } from '@commitlint/types';

import {
  PRIVATE_REFERENCES_RULE_NAME,
  privateReferencesPlugin
} from './commitlint-private-references.ts';

export const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  plugins: [privateReferencesPlugin],
  rules: {
    [PRIVATE_REFERENCES_RULE_NAME]: [RuleConfigSeverity.Error, 'always']
  }
};
