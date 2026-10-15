import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { build } from 'esbuild';

import {
  copyStaticFiles,
  getBuildOptions,
  resetOutputFolder
} from './helpers/site-build.ts';

await wrapCliTask(async () => {
  await resetOutputFolder();
  await build(getBuildOptions(true));
  await copyStaticFiles();
});
