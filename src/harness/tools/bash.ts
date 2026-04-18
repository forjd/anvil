import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ToolError } from '../core/errors';

import type { ToolDefinition } from './types';

const execFileAsync = promisify(execFile);

const getCommandArg = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolError('bash.command must be a non-empty string');
  }

  return value;
};

export const bashTool: ToolDefinition = {
  name: 'bash',
  description: 'Run a shell command inside the working directory.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute.' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  async execute(call, context) {
    const command = getCommandArg(call.arguments.command);
    const shell = process.env.SHELL || 'bash';
    const { stdout, stderr } = await execFileAsync(shell, ['-lc', command], {
      cwd: context.cwd,
      signal: context.signal,
      maxBuffer: 1024 * 1024,
    });

    const output = [stdout, stderr].filter((part) => part.length > 0).join('\n');

    return {
      content: [{ type: 'text', text: output || '(command produced no output)' }],
      details: { command, cwd: context.cwd },
    };
  },
};
