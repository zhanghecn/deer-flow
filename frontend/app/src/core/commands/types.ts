export interface PromptCommand {
  name: string;
  description: string;
}

export interface ResolvedCommandIntent {
  command: PromptCommand;
  rawInput: string;
  commandText: string;
  argsText: string;
  extraContext: Record<string, unknown>;
}
