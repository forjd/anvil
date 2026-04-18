import { randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { getHarnessPaths } from '../config';
import { appendJsonLine, readJsonLines } from './jsonl';
import { SessionError } from '../core/errors';
import { ensureDirectory } from '../util/paths';

import type { SessionEntry, SessionMetadata } from './types';
import type { Message } from '../agent/messages';

export interface LoadedSession {
  meta: SessionMetadata;
  entries: SessionEntry[];
}

export interface SessionManager {
  create(cwd: string): Promise<SessionMetadata>;
  load(sessionId: string): Promise<LoadedSession>;
  append(sessionId: string, entry: SessionEntry): Promise<void>;
  appendMessage(sessionId: string, message: Message): Promise<void>;
  list(cwd?: string): Promise<SessionMetadata[]>;
}

export class FileSessionManager implements SessionManager {
  constructor(private readonly sessionsDir = getHarnessPaths().sessionsDir) {}

  async create(cwd: string): Promise<SessionMetadata> {
    await ensureDirectory(this.sessionsDir);

    const timestamp = Date.now();
    const sessionId = randomUUID();
    const metadata: SessionMetadata = {
      id: sessionId,
      cwd,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.append(sessionId, { type: 'meta', meta: metadata });
    return metadata;
  }

  async load(sessionId: string): Promise<LoadedSession> {
    const entries = await readJsonLines<SessionEntry>(this.getSessionFilePath(sessionId));
    const metaEntry = entries.find((entry) => entry.type === 'meta');

    if (!metaEntry || metaEntry.type !== 'meta') {
      throw new SessionError(`Session ${sessionId} is missing metadata.`);
    }

    const fileStats = await stat(this.getSessionFilePath(sessionId));

    return {
      meta: {
        ...metaEntry.meta,
        updatedAt: Math.round(fileStats.mtimeMs),
      },
      entries,
    };
  }

  async append(sessionId: string, entry: SessionEntry): Promise<void> {
    await appendJsonLine(this.getSessionFilePath(sessionId), entry);
  }

  async appendMessage(sessionId: string, message: Message): Promise<void> {
    await this.append(sessionId, { type: 'message', message });
  }

  async list(cwd?: string): Promise<SessionMetadata[]> {
    await ensureDirectory(this.sessionsDir);

    const files = await readdir(this.sessionsDir);
    const sessions = await Promise.all(
      files
        .filter((fileName) => fileName.endsWith('.jsonl'))
        .map(async (fileName) => {
          const sessionId = fileName.replace(/\.jsonl$/, '');
          try {
            const session = await this.load(sessionId);
            return session.meta;
          } catch {
            return null;
          }
        }),
    );

    return sessions
      .filter((meta): meta is SessionMetadata => meta !== null)
      .filter((meta) => (cwd ? meta.cwd === cwd : true))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private getSessionFilePath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.jsonl`);
  }
}
