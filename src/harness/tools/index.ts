import { bashTool } from './bash';
import { editTool } from './edit';
import { readTool } from './read';
import { ToolRegistry } from './registry';
import { writeTool } from './write';

export const createDefaultToolRegistry = (): ToolRegistry => {
  const registry = new ToolRegistry();

  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(bashTool);

  return registry;
};

export * from './types';
export * from './registry';
export { bashTool, editTool, readTool, writeTool };
