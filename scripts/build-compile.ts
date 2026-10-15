import {
  checkProjectTypes,
  parseTsConfig,
  toCanonical
} from '@mnaoumov/typescript-dev-toolkit/check-project-types';
import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import {
  execFromRoot,
  getRootFolder
} from '@mnaoumov/typescript-dev-toolkit/root';
import { join } from 'node:path/posix';

const NODE_MODULES_SEGMENT = '/node_modules/';

await wrapCliTask(async () => {
  await execFromRoot('tsc --build --force');

  if (!validateProjectTypes()) {
    throw new Error('TypeScript declaration validation failed.');
  }
});

function shouldKeepProjectFile(fileName: string, rootCanonical: string): boolean {
  return fileName.startsWith(`${rootCanonical}/`) && !fileName.includes(NODE_MODULES_SEGMENT);
}

function validateProjectTypes(): boolean {
  const root = getRootFolder();

  if (!root) {
    throw new Error('Could not find root folder');
  }

  const rootCanonical = toCanonical(root);
  const { fileNames, options } = parseTsConfig(join(root, 'tsconfig.json'));

  if (!options.skipLibCheck) {
    return true;
  }

  return checkProjectTypes({
    options,
    rootNames: fileNames,
    shouldKeepFile: (fileName) => shouldKeepProjectFile(fileName, rootCanonical)
  });
}
