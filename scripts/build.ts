import { build } from 'esbuild';

import { exitIfScriptDisabled } from './helpers/env-toggle.ts';
import {
  copyStaticFiles,
  getBuildOptions,
  resetOutputFolder
} from './helpers/site-build.ts';

exitIfScriptDisabled();

await main();

async function main(): Promise<void> {
  await resetOutputFolder();
  await build(getBuildOptions(true));
  await copyStaticFiles();
}
