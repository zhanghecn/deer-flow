import { useMemo } from "react";
import type { ComponentProps } from "react";

import {
  MessageResponse,
  type MessageResponseProps,
} from "@/components/ai-elements/message";
import { parseKnowledgeCitationHref } from "@/core/knowledge/citations";
import { streamdownPlugins } from "@/core/streamdown";

import { CitationLink } from "../citations/citation-link";

export type MarkdownContentProps = {
  content: string;
  isLoading: boolean;
  rehypePlugins: MessageResponseProps["rehypePlugins"];
  className?: string;
  remarkPlugins?: MessageResponseProps["remarkPlugins"];
  components?: MessageResponseProps["components"];
};

/** Renders markdown content. */
export function MarkdownContent({
  content,
  rehypePlugins,
  className,
  remarkPlugins = streamdownPlugins.remarkPlugins,
  components: componentsFromProps,
}: MarkdownContentProps) {
  const components = useMemo(() => {
    return {
      a: (props: ComponentProps<"a">) => {
        if (parseKnowledgeCitationHref(props.href)) {
          return <CitationLink {...props} />;
        }
        return <a {...props} />;
      },
      ...componentsFromProps,
    };
  }, [componentsFromProps]);

  if (!content) return null;

  return (
    <MessageResponse
      className={className}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </MessageResponse>
  );
}
