export type CommandKind = "soft" | "hard";

export interface PromptCommand {
  name: string;
  kind: CommandKind;
  description: string;
  promptTemplate: string;
  authoringActions?: string[];
}

export interface ResolvedCommandIntent {
  command: PromptCommand;
  rawInput: string;
  commandText: string;
  argsText: string;
  promptText: string;
  extraContext: Record<string, unknown>;
}
