import React from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

type IntrinsicTag = keyof React.JSX.IntrinsicElements & string;

type StyledComponentProps<T extends IntrinsicTag> = React.PropsWithChildren<
  React.ComponentPropsWithoutRef<T> & ExtraProps
>;

type MarkdownCodeComponent = Exclude<
  NonNullable<Components["code"]>,
  keyof React.JSX.IntrinsicElements
>;

type CodeBlockProps = React.ComponentProps<MarkdownCodeComponent> & {
  inline?: boolean;
};

function createStyledComponent<T extends IntrinsicTag>(
  tag: T,
  className: string,
) {
  return function StyledComponent(props: StyledComponentProps<T>) {
    const { children } = props;
    return React.createElement(tag, { className }, children);
  };
}

function CodeBlockComponent(props: CodeBlockProps) {
  const { inline, className, children, ...rest } = props;
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const codeString = String(children).replace(/\n$/, "");

  if (inline || !language) {
    return (
      <code
        className="rounded bg-slate-100 px-1 py-0.5 text-[13px] font-mono text-rose-600"
        {...rest}
      >
        {children}
      </code>
    );
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {language}
        </span>
        <CopyButton text={codeString} />
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneLight}
        customStyle={{
          margin: 0,
          padding: "1rem",
          fontSize: "13px",
          lineHeight: "1.6",
          background: "#fafafa",
        }}
        showLineNumbers={codeString.split("\n").length > 3}
        lineNumberStyle={{
          color: "#a1a1aa",
          fontSize: "11px",
          minWidth: "2em",
          paddingRight: "1em",
        }}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
}

function PreComponent({ children }: StyledComponentProps<"pre">) {
  return <>{children}</>;
}

const ParagraphComponent = createStyledComponent(
  "p",
  "mb-3 leading-7 last:mb-0",
);

const UlComponent = createStyledComponent(
  "ul",
  "mb-3 list-disc space-y-1 pl-5 leading-7 last:mb-0",
);

const OlComponent = createStyledComponent(
  "ol",
  "mb-3 list-decimal space-y-1 pl-5 leading-7 last:mb-0",
);

const LiComponent = createStyledComponent("li", "leading-7");

const H1Component = createStyledComponent(
  "h1",
  "mb-3 mt-5 text-lg font-semibold text-slate-800 first:mt-0",
);

const H2Component = createStyledComponent(
  "h2",
  "mb-2 mt-4 text-base font-semibold text-slate-800 first:mt-0",
);

const H3Component = createStyledComponent(
  "h3",
  "mb-2 mt-3 text-sm font-semibold text-slate-700 first:mt-0",
);

const BlockquoteComponent = createStyledComponent(
  "blockquote",
  "mb-3 border-l-4 border-emerald-300 bg-emerald-50/50 pl-4 italic text-slate-600 last:mb-0",
);

const HrComponent = createStyledComponent("hr", "my-4 border-slate-200");

function TableComponent({ children }: StyledComponentProps<"table">) {
  return (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

const TheadComponent = createStyledComponent(
  "thead",
  "border-b border-slate-200 bg-slate-50",
);

const ThComponent = createStyledComponent(
  "th",
  "px-3 py-2 text-left text-xs font-semibold text-slate-600",
);

const TdComponent = createStyledComponent(
  "td",
  "border-b border-slate-100 px-3 py-2 text-slate-700",
);

function AComponent({ href, children }: StyledComponentProps<"a">) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-emerald-600 underline underline-offset-2 hover:text-emerald-700"
    >
      {children}
    </a>
  );
}

const StrongComponent = createStyledComponent(
  "strong",
  "font-semibold text-slate-800",
);

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlockComponent,
          pre: PreComponent,
          p: ParagraphComponent,
          ul: UlComponent,
          ol: OlComponent,
          li: LiComponent,
          h1: H1Component,
          h2: H2Component,
          h3: H3Component,
          blockquote: BlockquoteComponent,
          hr: HrComponent,
          table: TableComponent,
          thead: TheadComponent,
          th: ThComponent,
          td: TdComponent,
          a: AComponent,
          strong: StrongComponent,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="rounded px-2 py-0.5 text-[11px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}
