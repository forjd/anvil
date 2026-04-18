import { readFile, writeFile } from 'node:fs/promises';

import { ToolError } from '../core/errors';
import { resolveWithinRoot } from '../util/paths';

import type { ToolDefinition } from './types';

interface ExactEdit {
  oldText: string;
  newText: string;
}

const getStringArg = (value: unknown, name: string): string => {
  if (typeof value !== 'string') {
    throw new ToolError(`edit.${name} must be a string`);
  }

  return value;
};

const getEditsArg = (value: unknown): ExactEdit[] => {
  if (!Array.isArray(value)) {
    throw new ToolError('edit.edits must be an array');
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new ToolError(`edit.edits[${index}] must be an object`);
    }

    const candidate = entry as Record<string, unknown>;
    return {
      oldText: getStringArg(candidate.oldText, `edits[${index}].oldText`),
      newText: getStringArg(candidate.newText, `edits[${index}].newText`),
    };
  });
};

const applyExactEdits = (input: string, edits: ExactEdit[]): string => {
  let output = input;

  for (const edit of edits) {
    const matches = output.split(edit.oldText).length - 1;
    if (matches !== 1) {
      throw new ToolError(
        `edit.oldText must match exactly once. Got ${matches} matches for ${JSON.stringify(edit.oldText)}.`,
      );
    }

    output = output.replace(edit.oldText, edit.newText);
  }

  return output;
};

export const editTool: ToolDefinition = {
  name: 'edit',
  description: 'Apply exact text replacements to a UTF-8 text file inside the working directory.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit.' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            oldText: { type: 'string' },
            newText: { type: 'string' },
          },
          required: ['oldText', 'newText'],
          additionalProperties: false,
        },
      },
    },
    required: ['path', 'edits'],
    additionalProperties: false,
  },
  async execute(call, context) {
    const targetPath = resolveWithinRoot(context.cwd, getStringArg(call.arguments.path, 'path'));
    const edits = getEditsArg(call.arguments.edits);
    const original = await readFile(targetPath, 'utf8');
    const updated = applyExactEdits(original, edits);

    await writeFile(targetPath, updated, 'utf8');

    return {
      content: [{ type: 'text', text: `Edited ${targetPath}` }],
      details: { path: targetPath, edits: edits.length },
    };
  },
};
