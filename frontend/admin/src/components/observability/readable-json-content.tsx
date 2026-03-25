import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  allItemsMatch,
  extractMarkdownSource,
  hasTruncationMarker,
  isMessageLike,
  isObject,
  isScalar,
  isToolLike,
  normalizeReadableString,
  normalizeReadableValue,
  toRawText,
  unwrapLegacyValue,
} from "./json-inspector-utils";

const CONTENT_KEYS = new Set([
  "markdown",
  "text",
  "content",
  "message",
  "output",
  "response",
  "body",
  "final",
  "description",
]);

function renderMarkdown(text: string) {
  return (
    <div
      className={cn(
        "space-y-2 break-words text-sm",
        "[&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:text-sm [&_h2]:font-semibold",
        "[&_h3]:text-sm [&_h3]:font-medium",
        "[&_p]:leading-relaxed",
        "[&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2",
        "[&_code]:rounded [&_code]:bg-muted/80 [&_code]:px-1 [&_code]:py-0.5",
        "[&_ul]:list-disc [&_ul]:pl-4",
        "[&_ol]:list-decimal [&_ol]:pl-4",
        "[&_a]:text-blue-600 [&_a]:underline",
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function TruncationNotice() {
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400">
      {t("This field is truncated in the stored trace payload.")}
    </p>
  );
}

function ScalarTable({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value).filter(([, item]) => isScalar(item));
  if (!entries.length) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {entries.map(([key, item]) => (
        <div key={key} className="rounded-md border bg-background/60 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {key}
          </p>
          <p className="mt-1 text-sm break-words">{String(item ?? "-")}</p>
        </div>
      ))}
    </div>
  );
}

function MarkdownBlock({
  value,
  emptyLabel = t("No markdown-like content."),
}: {
  value: unknown;
  emptyLabel?: string;
}) {
  const markdownSource = extractMarkdownSource(value);

  if (!markdownSource || markdownSource.trim().length === 0) {
    return (
      <div className="rounded-md border bg-background/60 px-3 py-3 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hasTruncationMarker(markdownSource) && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("This field is truncated in the stored trace payload.")}
        </p>
      )}
      <div className="rounded-md border bg-background/60 px-3 py-3">
        {renderMarkdown(markdownSource)}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: Record<string, unknown> }) {
  const title = typeof tool.name === "string" ? tool.name : t("tool");
  const subtitle = typeof tool.type === "string" ? tool.type : null;
  const description = tool.description;
  const schema = tool.parameters ?? tool.arguments;

  return (
    <div className="rounded-md border bg-background/60 px-3 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </div>

      {description != null && <MarkdownBlock value={description} />}

      {schema != null && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("Schema / Arguments")}
          </p>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap break-all">
            {toRawText(normalizeReadableValue(schema))}
          </pre>
        </div>
      )}
    </div>
  );
}

function extractReasoningContent(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value
    .map((item) => {
      if (!isObject(item)) {
        return null;
      }
      const blockType = item.type;
      if (blockType !== "thinking" && blockType !== "reasoning") {
        return null;
      }

      for (const key of [
        "thinking",
        "reasoning",
        "reasoning_content",
        "text",
      ] as const) {
        const blockValue = item[key];
        if (typeof blockValue === "string" && blockValue.trim().length > 0) {
          return blockValue;
        }
      }

      return null;
    })
    .filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n");
}

function MessageCard({ message }: { message: Record<string, unknown> }) {
  const role = typeof message.role === "string" ? message.role : "message";
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const responseMetadata = isObject(message.response_metadata)
    ? message.response_metadata
    : null;
  const additionalKwargs = isObject(message.additional_kwargs)
    ? message.additional_kwargs
    : null;
  const reasoningContent =
    (typeof additionalKwargs?.reasoning_content === "string" &&
    additionalKwargs.reasoning_content.trim().length > 0
      ? additionalKwargs.reasoning_content
      : null) ?? extractReasoningContent(message.content);

  return (
    <div className="rounded-md border bg-background/60 px-3 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium">
          {t(role)}
        </span>
        {typeof message.name === "string" && (
          <span className="text-xs text-muted-foreground">{message.name}</span>
        )}
        {typeof message.tool_call_id === "string" && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {message.tool_call_id}
          </span>
        )}
      </div>

      {reasoningContent && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("Reasoning")}
          </p>
          <div className="rounded-md border border-dashed bg-background/50 px-3 py-3">
            {renderMarkdown(reasoningContent)}
          </div>
        </div>
      )}

      <MarkdownBlock value={message.content} emptyLabel={t("No text content.")} />

      {toolCalls.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("Tool Calls")}
          </p>
          <div className="space-y-2">
            {toolCalls.map((tool, index) => (
              <ToolCard
                key={`${message.id ?? role}-${index}`}
                tool={isObject(tool) ? tool : { raw: tool }}
              />
            ))}
          </div>
        </div>
      )}

      {responseMetadata && (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("Response Metadata")}
          </p>
          <ScalarTable value={responseMetadata} />
        </div>
      )}
    </div>
  );
}

export function RawJsonDetails({
  value,
  title = t("Advanced JSON"),
}: {
  value: unknown;
  title?: string;
}) {
  return (
    <details className="rounded-md border bg-muted/20">
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
        {title}
      </summary>
      <pre className="max-h-80 overflow-auto px-3 pb-3 text-[11px] whitespace-pre-wrap break-all">
        {toRawText(value)}
      </pre>
    </details>
  );
}

export function ReadableJsonContent({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  const { value: unwrappedValue, truncated } = unwrapLegacyValue(value);
  if (unwrappedValue !== value) {
    return (
      <div className="space-y-2">
        {truncated && <TruncationNotice />}
        <ReadableJsonContent value={unwrappedValue} depth={depth} />
      </div>
    );
  }

  if (depth > 3) {
    return (
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap break-all">
        {toRawText(value)}
      </pre>
    );
  }

  if (typeof value === "string") {
    const normalizedString = normalizeReadableString(value);
    if (normalizedString !== value) {
      return <ReadableJsonContent value={normalizedString} depth={depth} />;
    }

    return <MarkdownBlock value={value} />;
  }

  if (Array.isArray(value)) {
    const normalizedItems = value.map((item) => normalizeReadableValue(item));

    if (allItemsMatch(normalizedItems, isMessageLike)) {
      return (
        <div className="space-y-3">
          {(normalizedItems as Record<string, unknown>[]).map(
            (message, index) => (
              <MessageCard key={`${message.id ?? index}`} message={message} />
            ),
          )}
        </div>
      );
    }

    if (allItemsMatch(normalizedItems, isToolLike)) {
      return (
        <div className="space-y-3">
          {(normalizedItems as Record<string, unknown>[]).map((tool, index) => (
            <ToolCard key={`${tool.name ?? index}`} tool={tool} />
          ))}
        </div>
      );
    }

    if (normalizedItems.length === 0) {
      return (
        <div className="rounded-md border bg-background/60 px-3 py-3 text-sm text-muted-foreground">
          {t("Empty array")}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {normalizedItems.map((item, index) => (
          <div
            key={index}
            className="rounded-md border bg-background/60 px-3 py-3"
          >
            <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("Item {index}", { index: index + 1 })}
            </p>
            <ReadableJsonContent value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  if (isMessageLike(value)) {
    return <MessageCard message={value} />;
  }

  if (isToolLike(value)) {
    return <ToolCard tool={value} />;
  }

  if (isObject(value)) {
    const markdownSource = extractMarkdownSource(value);
    const scalarEntries = Object.fromEntries(
      Object.entries(value).filter(
        ([key, item]) =>
          !(markdownSource && CONTENT_KEYS.has(key)) && isScalar(item),
      ),
    );
    const nestedEntries = Object.entries(value).filter(
      ([key, item]) =>
        !(markdownSource && CONTENT_KEYS.has(key)) && !isScalar(item),
    );

    return (
      <div className="space-y-3">
        {markdownSource && markdownSource.trim().length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("Content")}
            </p>
            <MarkdownBlock value={markdownSource} />
          </div>
        )}

        <ScalarTable value={scalarEntries} />

        {nestedEntries.length > 0 && depth < 2 && (
          <div className="space-y-2">
            {nestedEntries.map(([key, item]) => (
              <div
                key={key}
                className="rounded-md border bg-background/60 px-3 py-3 space-y-2"
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {key}
                </p>
                <ReadableJsonContent value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}

        {!markdownSource &&
          Object.keys(scalarEntries).length === 0 &&
          nestedEntries.length === 0 && (
            <div className="rounded-md border bg-background/60 px-3 py-3 text-sm text-muted-foreground">
              {t("Empty object")}
            </div>
          )}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background/60 px-3 py-3 text-sm break-words">
      {String(value)}
    </div>
  );
}
