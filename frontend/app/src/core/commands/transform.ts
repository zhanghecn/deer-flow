import type { ResolvedCommandIntent } from "./types";

import { findPromptCommand } from "./index";

// These regexes parse only explicit mention syntax written by the user.
// They are not a license to infer document targets from arbitrary prose.
const KNOWLEDGE_BRACKET_REFERENCE_RE =
  /(?:^|[\s([{（【])@(?:knowledge|kb|doc|document)\[([^\]\n]+)\]/gi;
const KNOWLEDGE_QUOTED_REFERENCE_RE =
  /(?:^|[\s([{（【])@["“'`]([^"”'`\n]+)["”'`]/g;
const KNOWLEDGE_INLINE_REFERENCE_RE =
  /(?:^|[\s([{（【])@([^\s,，。:：;；!！?？()（）[\]{}<>《》]+)/g;

function pushUniqueReference(
  target: string[],
  seen: Set<string>,
  value: string,
): void {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  const key = trimmed.toLocaleLowerCase();
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  target.push(trimmed);
}

function extractKnowledgeDocumentMentions(input: string): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  const matchedRanges: Array<{ start: number; end: number }> = [];
  const structuredMatches: Array<{ start: number; value: string }> = [];

  const collectPattern = (pattern: RegExp, shouldTrackRange = true) => {
    pattern.lastIndex = 0;
    for (const match of input.matchAll(pattern)) {
      const value = match[1]?.trim();
      const start = match.index ?? -1;
      if (!value || start < 0) {
        continue;
      }

      if (shouldTrackRange) {
        matchedRanges.push({
          start,
          end: start + match[0].length,
        });
      }
      structuredMatches.push({ start, value });
    }
  };

  collectPattern(KNOWLEDGE_BRACKET_REFERENCE_RE);
  collectPattern(KNOWLEDGE_QUOTED_REFERENCE_RE);

  KNOWLEDGE_INLINE_REFERENCE_RE.lastIndex = 0;
  for (const match of input.matchAll(KNOWLEDGE_INLINE_REFERENCE_RE)) {
    const value = match[1]?.trim();
    const start = match.index ?? -1;
    if (!value || start < 0) {
      continue;
    }

    const overlap = matchedRanges.some(
      (range) => start < range.end && start + match[0].length > range.start,
    );
    if (overlap) {
      continue;
    }

    const normalized = value.toLocaleLowerCase();
    if (
      normalized === "knowledge" ||
      normalized === "kb" ||
      normalized === "doc" ||
      normalized === "document"
    ) {
      continue;
    }

    structuredMatches.push({ start, value });
  }

  structuredMatches.sort((left, right) => left.start - right.start);
  for (const match of structuredMatches) {
    pushUniqueReference(resolved, seen, match.value);
  }

  return resolved;
}

export function resolveCommandIntent(
  input: string,
): ResolvedCommandIntent | null {
  const rawInput = input.trim();
  if (!rawInput.startsWith("/")) {
    return null;
  }

  const firstSpace = rawInput.indexOf(" ");
  const commandText =
    firstSpace === -1 ? rawInput.slice(1) : rawInput.slice(1, firstSpace);
  const argsText =
    firstSpace === -1 ? "" : rawInput.slice(firstSpace + 1).trim();
  const command = findPromptCommand(commandText);
  if (!command) {
    return null;
  }

  return {
    command,
    rawInput,
    commandText: command.name,
    argsText,
    extraContext: {
      command_name: command.name,
      command_args: argsText,
      original_user_input: rawInput,
    },
  };
}

export function buildPromptExtraContext(
  input: string,
): Record<string, unknown> | undefined {
  const extraContext: Record<string, unknown> = {};
  const resolvedCommand = resolveCommandIntent(input);
  if (resolvedCommand) {
    Object.assign(extraContext, resolvedCommand.extraContext);
  }

  const knowledgeDocumentMentions = extractKnowledgeDocumentMentions(input);
  if (knowledgeDocumentMentions.length > 0) {
    extraContext.knowledge_document_mentions = knowledgeDocumentMentions;
    if (typeof extraContext.original_user_input !== "string") {
      extraContext.original_user_input = input.trim();
    }
  }

  return Object.keys(extraContext).length > 0 ? extraContext : undefined;
}

export function buildCreateAgentFlowExtraContext(
  input: string,
  targetAgentName: string,
): Record<string, unknown> | undefined {
  const trimmed = input.trim();
  const baseContext = buildPromptExtraContext(input) ?? {};

  if (trimmed && !("command_name" in baseContext)) {
    baseContext.command_name = "create-agent";
    baseContext.command_args = trimmed;
    baseContext.original_user_input = trimmed;
  }

  if (
    targetAgentName.trim() &&
    (!("target_agent_name" in baseContext) ||
      baseContext.target_agent_name == null ||
      baseContext.target_agent_name === "")
  ) {
    baseContext.target_agent_name = targetAgentName.trim();
  }

  return Object.keys(baseContext).length > 0 ? baseContext : undefined;
}

export function getSlashQuery(input: string): string | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const withoutSlash = trimmed.slice(1);
  const firstSpace = withoutSlash.indexOf(" ");
  if (firstSpace !== -1) {
    return null;
  }
  return withoutSlash;
}
