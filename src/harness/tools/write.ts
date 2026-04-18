import { writeFile } from 'node:fs/promises';

import { ToolError } from '../core/errors';
import { ensureParentDirectory, resolveWithinRoot } from '../util/paths';

import type { ToolDefinition } from './types';

const getStringArg = (value: unknown, name: string): string => {
  if (typeof value !== 'string') {
    throw new ToolError(`write.${name} must be a string`);
  }

  return value;
};

export const writeTool: ToolDefinition = {
  name: 'write',
  description: 'Write a UTF-8 text file inside the working directory.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write.' },
      content: { type: 'string', description: 'Full file contents.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  async execute(call, context) {
    const targetPath = resolveWithinRoot(context.cwd, getStringArg(call.arguments.path, 'path'));
    const content = getStringArg(call.arguments.content, 'content');

    await ensureParentDirectory(targetPath);
    await writeFile(targetPath, content, 'utf8');

    return {
      content: [{ type: 'text', text: `Wrote ${targetPath}` }],
      details: { path: targetPath, bytes: Buffer.byteLength(content, 'utf8') },
    };
  },
};
