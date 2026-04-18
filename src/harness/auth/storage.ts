import { getHarnessPaths } from '../config';
import { readJsonFile, writeJsonFile } from '../util/json';

import type { AuthRecord } from './types';

export interface AuthStorage {
  load(): Promise<Record<string, AuthRecord>>;
  save(records: Record<string, AuthRecord>): Promise<void>;
  get(providerId: string): Promise<AuthRecord | undefined>;
  set(providerId: string, record: AuthRecord): Promise<void>;
  remove(providerId: string): Promise<void>;
}

export class FileAuthStorage implements AuthStorage {
  constructor(private readonly filePath = getHarnessPaths().authFilePath) {}

  async load(): Promise<Record<string, AuthRecord>> {
    return readJsonFile<Record<string, AuthRecord>>(this.filePath, {});
  }

  async save(records: Record<string, AuthRecord>): Promise<void> {
    await writeJsonFile(this.filePath, records, 0o600);
  }

  async get(providerId: string): Promise<AuthRecord | undefined> {
    const records = await this.load();
    return records[providerId];
  }

  async set(providerId: string, record: AuthRecord): Promise<void> {
    const records = await this.load();
    records[providerId] = record;
    await this.save(records);
  }

  async remove(providerId: string): Promise<void> {
    const records = await this.load();
    delete records[providerId];
    await this.save(records);
  }
}
