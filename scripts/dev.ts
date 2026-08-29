import type {
  BuildContext,
  Plugin,
  ServeResult
} from 'esbuild';

import { context } from 'esbuild';
import process from 'node:process';

import { exitIfScriptDisabled } from './helpers/env-toggle.ts';
import {
  copyStaticFiles,
  getBuildOptions,
  getOutputFolder,
  resetOutputFolder
} from './helpers/site-build.ts';

const DEV_PORT = 4173;

/** `0` asks the OS for any free port, which is the fallback when the preferred one is taken. */
const ANY_PORT = 0;

const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

exitIfScriptDisabled();

await main();

/** Keeps the served HTML and CSS in step with the bundle on every rebuild. */
function copyStaticFilesPlugin(): Plugin {
  return {
    name: 'copy-static-files',
    setup(build): void {
      build.onEnd(async (): Promise<void> => {
        await copyStaticFiles();
      });
    }
  };
}

async function main(): Promise<void> {
  await resetOutputFolder();

  const ctx = await context({
    ...getBuildOptions(false),
    plugins: [copyStaticFilesPlugin()]
  });

  /*
   * The esbuild service is a child process and it holds the listening socket. Without this it
   * survives its parent being killed and keeps the port bound, so the next `npm run dev` dies with
   * EADDRINUSE.
   */
  registerShutdown(ctx);

  await ctx.watch();

  const { hosts, port } = await serve(ctx);
  const host = hosts.includes('127.0.0.1') ? '127.0.0.1' : hosts[0] ?? 'localhost';

  if (port !== DEV_PORT) {
    process.stdout.write(`Port ${String(DEV_PORT)} was busy, so this run took ${String(port)} instead.\n`);
  }

  process.stdout.write(`Secret Hitler Companion running at http://${host}:${String(port)}/\n`);
  process.stdout.write('Watching for changes. Press Ctrl+C to stop.\n');
}

function registerShutdown(ctx: BuildContext): void {
  let isStopping = false;

  async function stop(): Promise<void> {
    if (isStopping) {
      return;
    }

    isStopping = true;
    await ctx.dispose();
    process.exit(0);
  }

  for (const signal of STOP_SIGNALS) {
    process.on(signal, () => {
      stop().catch((error: unknown) => {
        process.stderr.write(`Failed to shut down cleanly: ${String(error)}\n`);
        process.exit(1);
      });
    });
  }
}

/** A stale server from a previous run should slow you down, not stop you. */
async function serve(ctx: BuildContext): Promise<ServeResult> {
  const servedir = getOutputFolder();

  try {
    return await ctx.serve({ port: DEV_PORT, servedir });
  } catch {
    return await ctx.serve({ port: ANY_PORT, servedir });
  }
}
