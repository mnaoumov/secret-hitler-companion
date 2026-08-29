import type { BuildOptions } from 'esbuild';

import {
  cp,
  mkdir,
  rm
} from 'node:fs/promises';
import { join } from 'node:path/posix';

import { getRootFolder } from './root.ts';

const STATIC_FILES = ['index.html', 'styles.css'];

/** The HTML and CSS are copied rather than bundled, so a watch run has to re-copy them itself. */
export async function copyStaticFiles(): Promise<void> {
  const root = getRoot();
  const outputFolder = getOutputFolder();

  await Promise.all(STATIC_FILES.map(async (fileName) => cp(join(root, 'src', fileName), join(outputFolder, fileName))));
}

export function getBuildOptions(isProduction: boolean): BuildOptions {
  return {
    bundle: true,
    entryPoints: [join(getRoot(), 'src/ui/main.ts')],
    format: 'esm',
    minify: isProduction,
    outfile: join(getOutputFolder(), 'app.js'),
    sourcemap: !isProduction,
    target: 'es2022'
  };
}

export function getOutputFolder(): string {
  return join(getRoot(), 'dist');
}

export function getRoot(): string {
  const root = getRootFolder();

  if (!root) {
    throw new Error('Could not find root folder');
  }

  return root;
}

export async function resetOutputFolder(): Promise<void> {
  const outputFolder = getOutputFolder();

  await rm(outputFolder, { force: true, recursive: true });
  await mkdir(outputFolder, { recursive: true });
}
