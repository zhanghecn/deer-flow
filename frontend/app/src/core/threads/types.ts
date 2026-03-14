import type { Interrupt, Message, Thread } from "@langchain/langgraph-sdk";

import type { Todo } from "../todos";

export interface ContextWindowThreshold {
  type?: string;
  value?: number;
  current?: number | null;
  matched?: boolean;
  label?: string;
}

export interface ContextWindowSummary {
  created_at?: string;
  cutoff_index?: number;
  state_cutoff_index?: number;
  summarized_message_count?: number;
  preserved_message_count?: number;
  file_path?: string | null;
  summary_preview?: string;
}

export interface ContextWindowState {
  updated_at?: string;
  approx_input_tokens?: number;
  approx_input_tokens_after_summary?: number | null;
  max_input_tokens?: number | null;
  usage_ratio?: number | null;
  usage_ratio_after_summary?: number | null;
  raw_message_count?: number;
  effective_message_count?: number;
  effective_message_count_after_summary?: number | null;
  trigger_thresholds?: ContextWindowThreshold[];
  trigger_reasons?: string[];
  keep?: {
    type?: string;
    value?: number;
  } | null;
  triggered?: boolean;
  summary_applied?: boolean;
  summary_count?: number;
  last_summary?: ContextWindowSummary | null;
}

export interface AgentThreadState extends Record<string, unknown> {
  title: string;
  messages: Message[];
  artifacts: string[];
  todos?: Todo[];
  context_window?: ContextWindowState;
}

export interface AgentThread extends Thread<AgentThreadState> {}

export type AgentInterruptActionRequest = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

export type AgentInterruptValue = {
  action_requests?: AgentInterruptActionRequest[];
  review_configs?: unknown[];
  [key: string]: unknown;
};

export type AgentInterrupt = Interrupt<AgentInterruptValue>;

export interface AgentThreadContext extends Record<string, unknown> {
  thread_id: string;
  model_name: string | undefined;
  thinking_enabled: boolean;
  is_plan_mode: boolean;
  subagent_enabled: boolean;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  agent_name?: string;
}
