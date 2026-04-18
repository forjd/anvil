import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const ensureDirectory = async (directoryPath: string): Promise<void> => {
  await mkdir(directoryPath, { recursive: true });
};

export const ensureParentDirectory = async (filePath: string): Promise<void> => {
  await ensureDirectory(dirname(filePath));
};

export const resolveFromCwd = (cwd: string, targetPath: string): string =>
  isAbsolute(targetPath) ? resolve(targetPath) : resolve(cwd, targetPath);

export const assertPathWithinRoot = (root: string, candidatePath: string): string => {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidatePath);
  const rel = relative(normalizedRoot, normalizedCandidate);

  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return normalizedCandidate;
  }

  throw new Error(`Path escapes root: ${candidatePath}`);
};

export const resolveWithinRoot = (root: string, targetPath: string): string =>
  assertPathWithinRoot(root, resolveFromCwd(root, targetPath));
