import type {
  PublicAPITurnEvent,
  PublicAPITurnSnapshot,
  PublicAPITurnUsage,
} from "./api";
import type { PublicAPINormalizedRunEvent } from "./events";
import type { PublicAPIRunReadModel } from "./run-session";

type PublicAPISDKMessageBase = {
  uuid: string;
  session_id: string;
  turn_id?: string;
};

export type PublicAPISDKAssistantContentBlock =
  | {
      type: "thinking";
      thinking: string;
    }
  | {
      type: "text";
      text: string;
    };

export type PublicAPISDKMessage =
  | (PublicAPISDKMessageBase & {
      type: "system";
      subtype: "init";
      agent: string;
    })
  | (PublicAPISDKMessageBase & {
      type: "system";
      subtype: "context_compacted";
      context_before_tokens?: number;
      context_after_tokens?: number;
      context_max_tokens?: number;
      summary_count?: number;
    })
  | (PublicAPISDKMessageBase & {
      type: "assistant";
      message: {
        id: string;
        type: "message";
        role: "assistant";
        model: string;
        content: PublicAPISDKAssistantContentBlock[];
        usage?: PublicAPITurnUsage;
      };
    })
  | (PublicAPISDKMessageBase & {
      type: "tool_call";
      tool_call_id: string;
      tool_name: string;
      tool_arguments: unknown;
    })
  | (PublicAPISDKMessageBase & {
      type: "tool_result";
      tool_call_id: string;
      tool_name?: string;
      tool_output: unknown;
    })
  | (PublicAPISDKMessageBase & {
      type: "result";
      subtype: "success";
      output_text: string;
      reasoning_text: string;
      usage: PublicAPITurnUsage;
      artifacts: PublicAPITurnSnapshot["artifacts"];
    })
  | (PublicAPISDKMessageBase & {
      type: "result";
      subtype: "error";
      error: string;
      usage?: PublicAPITurnUsage;
    })
  | (PublicAPISDKMessageBase & {
      type: "stream_event";
      event: PublicAPITurnEvent;
    });

// Plain Omit collapses a union to the keys common to every branch. Keep the
// SDK message variants separate so emit sites retain branch-specific fields.
type PublicAPISDKMessageDraft = PublicAPISDKMessage extends infer Message
  ? Message extends unknown
    ? Omit<Message, "uuid" | "session_id">
    : never
  : never;

export type PublicAPISDKMessageUpdate = {
  message: PublicAPISDKMessage;
  readModel: PublicAPIRunReadModel;
};

function createSDKMessageID() {
  const cryptoAPI = globalThis.crypto;
  if (typeof cryptoAPI?.randomUUID === "function") {
    return cryptoAPI.randomUUID();
  }
  return `sdkmsg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildAssistantContent(params: {
  text: string;
  reasoning: string;
}): PublicAPISDKAssistantContentBlock[] {
  const content: PublicAPISDKAssistantContentBlock[] = [];
  if (params.reasoning) {
    content.push({
      type: "thinking",
      thinking: params.reasoning,
    });
  }
  if (params.text) {
    content.push({
      type: "text",
      text: params.text,
    });
  }
  return content;
}

function failureText(event: PublicAPITurnEvent) {
  return event.error || event.status || "Turn failed";
}

export function createPublicAPISDKMessageProjector(params: {
  agent: string;
  sessionId: string;
  includePartialMessages?: boolean;
  onMessage?: (update: PublicAPISDKMessageUpdate) => void;
}) {
  const messages: PublicAPISDKMessage[] = [];
  let emittedInit = false;
  let emittedResult = false;

  const emit = (
    message: PublicAPISDKMessageDraft,
    readModel: PublicAPIRunReadModel,
  ) => {
    const next = {
      uuid: createSDKMessageID(),
      session_id: params.sessionId,
      ...message,
    } as PublicAPISDKMessage;
    messages.push(next);
    params.onMessage?.({
      message: next,
      readModel,
    });
  };

  const emitInit = (readModel: PublicAPIRunReadModel) => {
    if (emittedInit) {
      return;
    }
    emittedInit = true;
    emit(
      {
        type: "system",
        subtype: "init",
        agent: params.agent,
        turn_id: readModel.turnId || undefined,
      },
      readModel,
    );
  };

  const emitAssistant = (
    readModel: PublicAPIRunReadModel,
    turn: PublicAPITurnSnapshot,
  ) => {
    if (!turn.output_text && !turn.reasoning_text) {
      return;
    }
    emit(
      {
        type: "assistant",
        turn_id: turn.id,
        message: {
          id: `msg_${turn.id}`,
          type: "message",
          role: "assistant",
          model: params.agent,
          content: buildAssistantContent({
            text: turn.output_text,
            reasoning: turn.reasoning_text,
          }),
          usage: turn.usage,
        },
      },
      readModel,
    );
  };

  const emitErrorResult = (
    event: PublicAPITurnEvent,
    readModel: PublicAPIRunReadModel,
  ) => {
    if (emittedResult) {
      return;
    }
    emittedResult = true;
    emit(
      {
        type: "result",
        subtype: "error",
        turn_id: event.turn_id || readModel.turnId || undefined,
        error: failureText(event),
      },
      readModel,
    );
  };

  return {
    messages,
    consume(update: {
      event: PublicAPINormalizedRunEvent;
      readModel: PublicAPIRunReadModel;
    }) {
      emitInit(update.readModel);

      if (update.event.kind !== "ledger_event") {
        return;
      }

      const event = update.event.event;
      if (params.includePartialMessages) {
        emit(
          {
            type: "stream_event",
            turn_id: event.turn_id || update.readModel.turnId || undefined,
            event,
          },
          update.readModel,
        );
      }

      switch (event.type) {
        case "tool.call.started":
          emit(
            {
              type: "tool_call",
              turn_id: event.turn_id || update.readModel.turnId || undefined,
              tool_call_id: event.tool_call_id || "",
              tool_name: event.tool_name || "unknown",
              tool_arguments: event.tool_arguments ?? {},
            },
            update.readModel,
          );
          break;
        case "tool.call.completed":
          emit(
            {
              type: "tool_result",
              turn_id: event.turn_id || update.readModel.turnId || undefined,
              tool_call_id: event.tool_call_id || "",
              tool_name: event.tool_name,
              tool_output: event.tool_output,
            },
            update.readModel,
          );
          break;
        case "context.compacted":
          emit(
            {
              type: "system",
              subtype: "context_compacted",
              turn_id: event.turn_id || update.readModel.turnId || undefined,
              context_before_tokens: event.context_before_tokens,
              context_after_tokens: event.context_after_tokens,
              context_max_tokens: event.context_max_tokens,
              summary_count: event.summary_count,
            },
            update.readModel,
          );
          break;
        case "turn.failed":
          emitErrorResult(event, update.readModel);
          break;
      }
    },
    finalizeTurn(
      turn: PublicAPITurnSnapshot | null,
      readModel: PublicAPIRunReadModel,
    ) {
      emitInit(readModel);
      if (!turn) {
        return;
      }

      if (turn.status === "failed") {
        const failureEvent = Array.isArray(turn.events)
          ? turn.events.find((event) => event.type === "turn.failed")
          : undefined;
        if (failureEvent) {
          emitErrorResult(failureEvent, readModel);
          return;
        }
        emitErrorResult(
          {
            sequence: 0,
            created_at: turn.completed_at ?? turn.created_at,
            type: "turn.failed",
            turn_id: turn.id,
            error: "Turn failed",
          },
          readModel,
        );
        return;
      }

      emitAssistant(readModel, turn);
      if (emittedResult) {
        return;
      }
      emittedResult = true;
      emit(
        {
          type: "result",
          subtype: "success",
          turn_id: turn.id,
          output_text: turn.output_text,
          reasoning_text: turn.reasoning_text,
          usage: turn.usage,
          artifacts: turn.artifacts,
        },
        readModel,
      );
    },
  };
}
