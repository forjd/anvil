import { appendFile, readFile } from 'node:fs/promises';

import { SessionError } from '../core/errors';
import { ensureParentDirectory } from '../util/paths';

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const appendJsonLine = async (filePath: string, value: unknown): Promise<void> => {
  await ensureParentDirectory(filePath);
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
};

export const readJsonLines = async <T>(filePath: string): Promise<T[]> => {
  try {
    const contents = await readFile(filePath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.trim().length > 0);

    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new SessionError(`Invalid JSONL at ${filePath}:${index + 1}`, { cause: error });
      }
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
};
