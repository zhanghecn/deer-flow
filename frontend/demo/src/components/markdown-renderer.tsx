import { Streamdown, type MermaidConfig } from "streamdown";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
}

const safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;

function streamdownUrlTransform(url: string) {
  if (url.startsWith("kb://")) {
    return url;
  }

  const colon = url.indexOf(":");
  const questionMark = url.indexOf("?");
  const numberSign = url.indexOf("#");
  const slash = url.indexOf("/");

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    safeProtocol.test(url.slice(0, colon))
  ) {
    return url;
  }

  return "";
}

const mermaidConfig = {
  theme: "base",
  themeVariables: {
    primaryColor: "#e0f2fe",
    primaryTextColor: "#0f172a",
    primaryBorderColor: "#38bdf8",
    lineColor: "#64748b",
    secondaryColor: "#ecfdf5",
    tertiaryColor: "#f8fafc",
    fontFamily:
      "IBM Plex Mono, IBM Plex Sans, PingFang SC, Microsoft YaHei, sans-serif",
  },
} satisfies MermaidConfig;

export function MarkdownRenderer({
  content,
  className = "",
  isStreaming = false,
}: MarkdownRendererProps) {
  if (!content) {
    return null;
  }

  return (
    <Streamdown
      className={`markdown-body ${className}`}
      // Keep demo chat behavior aligned with the 8083 workspace renderer:
      // Streamdown owns Mermaid, math, syntax highlighting, and partial blocks.
      mermaidConfig={mermaidConfig}
      isAnimating={isStreaming}
      urlTransform={streamdownUrlTransform}
    >
      {content}
    </Streamdown>
  );
}
