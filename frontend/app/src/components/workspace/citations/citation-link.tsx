import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import {
  Children,
  isValidElement,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { parseKnowledgeCitationHref } from "@/core/knowledge/citations";
import { cn } from "@/lib/utils";

import { useArtifacts } from "../artifacts";

export function CitationLink({
  href,
  children,
  className,
  onClick,
  ...props 
}: ComponentProps<"a">) {
  const { reveal } = useArtifacts();
  const knowledgeCitation = parseKnowledgeCitationHref(href);
  const domain = extractDomain(href ?? "");

  const childrenText = normalizeCitationText(extractTextContent(children));
  const isGenericText = childrenText === "Source" || childrenText === "来源";
  const displayText =
    (!isGenericText ? childrenText : null) ??
    knowledgeCitation?.locatorLabel ??
    knowledgeCitation?.documentName ??
    domain;

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) {
      return;
    }

    event.stopPropagation();
    if (!knowledgeCitation) {
      return;
    }

    event.preventDefault();
    reveal({
      filepath: knowledgeCitation.artifactPath,
      page: knowledgeCitation.page,
      heading: knowledgeCitation.heading,
      line: knowledgeCitation.line,
      locatorLabel: knowledgeCitation.locatorLabel,
    });
  }

  return (
    <HoverCard closeDelay={0} openDelay={0}>
      <HoverCardTrigger asChild>
        <a
          {...props}
          href={href}
          target={knowledgeCitation ? undefined : "_blank"}
          rel={knowledgeCitation ? undefined : "noopener noreferrer"}
          className={cn("inline-flex items-center", className)}
          onClick={handleClick}
        >
          <Badge
            variant="secondary"
            className="hover:bg-secondary/80 mx-0.5 cursor-pointer gap-1 rounded-full px-2 py-0.5 text-xs font-normal"
          >
            {displayText}
            {knowledgeCitation ? (
              <FileTextIcon className="size-3" />
            ) : (
              <ExternalLinkIcon className="size-3" />
            )}
          </Badge>
        </a>
      </HoverCardTrigger>
      <HoverCardContent className="relative w-80 p-0">
        <div className="p-3">
          <div className="space-y-1">
            {displayText && (
              <h4 className="truncate font-medium text-sm leading-tight">
                {displayText}
              </h4>
            )}
            {knowledgeCitation ? (
              <p className="truncate break-all text-muted-foreground text-xs">
                {knowledgeCitation.documentName ?? "Knowledge source"}
              </p>
            ) : href ? (
              <p className="truncate break-all text-muted-foreground text-xs">
                {href}
              </p>
            ) : null}
          </div>
          {knowledgeCitation ? (
            <div className="text-primary mt-2 inline-flex items-center gap-1 text-xs">
              Open source preview
              <FileTextIcon className="size-3" />
            </div>
          ) : (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary mt-2 inline-flex items-center gap-1 text-xs hover:underline"
            >
              Visit source
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function normalizeCitationText(text: string): string | null {
  const normalizedText = text.replace(/^citation:\s*/i, "").trim();
  return normalizedText || null;
}

function extractTextContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return extractTextContent(child.props.children);
      }
      return "";
    })
    .join("");
}
