import { homedir } from 'node:os';
import { join } from 'node:path';

export const HARNESS_DIR_NAME = 'anvil';
export const AUTH_FILE_NAME = 'auth.json';
export const SESSIONS_DIR_NAME = 'sessions';
export const DEFAULT_SYSTEM_PROMPT =
  'You are Anvil, a local-first coding agent for working inside developer repositories.';

export interface HarnessPaths {
  rootDir: string;
  authFilePath: string;
  sessionsDir: string;
}

export const getHarnessPaths = (): HarnessPaths => {
  const rootDir = join(homedir(), '.anvil');

  return {
    rootDir,
    authFilePath: join(rootDir, AUTH_FILE_NAME),
    sessionsDir: join(rootDir, SESSIONS_DIR_NAME),
  };
};
