import type { Interrupt, Message, Thread } from "@langchain/langgraph-sdk";

import type { Todo } from "../todos";
import type {
  DesignSelectionContext,
  SurfaceContextPayload,
} from "../workspace-surface/types";

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

export type ExecutionEventName =
  | "run_started"
  | "phase_started"
  | "phase_finished"
  | "retrying"
  | "retry_completed"
  | "retry_failed";

export type ExecutionPhaseKind = "model" | "tool" | "retry";

export interface ExecutionEvent {
  type: "execution_event";
  event: ExecutionEventName;
  occurred_at: string;
  phase?: string;
  phase_kind?: ExecutionPhaseKind;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  tool_name?: string;
  retry_count?: number;
  max_retries?: number;
  delay_seconds?: number;
  error?: string;
  error_type?: string;
}

export interface ExecutionStatus {
  event: ExecutionEventName | "completed" | "failed" | "interrupted";
  phase?: string;
  phase_kind?: ExecutionPhaseKind | "run";
  started_at: string;
  run_started_at: string;
  finished_at?: string;
  duration_ms?: number;
  total_duration_ms?: number;
  tool_name?: string;
  retry_count?: number;
  max_retries?: number;
  delay_seconds?: number;
  error?: string;
  error_type?: string;
  terminal?: boolean;
}

export interface TaskRunningEvent {
  type: "task_running";
  task_id: string;
  message: Message;
}

export type ThreadRuntimeEvent = ExecutionEvent | TaskRunningEvent;

export interface ThreadRuntimeBinding {
  agent_name?: string;
  agent_status?: "dev" | "prod";
  execution_backend?: "remote";
  remote_session_id?: string;
  model_name?: string;
}

export interface AgentThread
  extends Thread<AgentThreadState>, ThreadRuntimeBinding {}

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
  agent_status?: "dev" | "prod";
  execution_backend?: "remote";
  remote_session_id?: string;
}

export type ThreadSurfaceContext = SurfaceContextPayload;

export type ThreadSelectionContext = DesignSelectionContext;
