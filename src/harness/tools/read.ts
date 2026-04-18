import { readFile } from 'node:fs/promises';

import { ToolError } from '../core/errors';
import { resolveWithinRoot } from '../util/paths';

import type { ToolDefinition } from './types';

const getPathArg = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolError('read.path must be a non-empty string');
  }

  return value;
};

export const readTool: ToolDefinition = {
  name: 'read',
  description: 'Read a UTF-8 text file inside the working directory.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async execute(call, context) {
    const targetPath = resolveWithinRoot(context.cwd, getPathArg(call.arguments.path));
    const content = await readFile(targetPath, 'utf8');

    return {
      content: [{ type: 'text', text: content }],
      details: { path: targetPath },
    };
  },
};
