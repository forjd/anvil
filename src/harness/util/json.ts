import { chmod, readFile, rename, writeFile } from 'node:fs/promises';

import { ensureParentDirectory } from './paths';

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const contents = await readFile(filePath, 'utf8');
    return JSON.parse(contents) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return fallback;
    }

    throw error;
  }
};

export const writeJsonFile = async (
  filePath: string,
  value: unknown,
  mode = 0o600,
): Promise<void> => {
  await ensureParentDirectory(filePath);

  const tempPath = `${filePath}.tmp`;
  const contents = `${JSON.stringify(value, null, 2)}\n`;

  await writeFile(tempPath, contents, { encoding: 'utf8', mode });
  await rename(tempPath, filePath);
  await chmod(filePath, mode);
};
