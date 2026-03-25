import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import type { ComponentProps } from "react";

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
  ...props 
}: ComponentProps<"a">) {
  const { reveal } = useArtifacts();
  const knowledgeCitation = parseKnowledgeCitationHref(href);
  const domain = extractDomain(href ?? "");
  
  // Priority: children > domain
  const childrenText =
    typeof children === "string"
      ? children.replace(/^citation:\s*/i, "")
      : null;
  const isGenericText = childrenText === "Source" || childrenText === "来源";
  const displayText =
    (!isGenericText && childrenText) ??
    knowledgeCitation?.locatorLabel ??
    knowledgeCitation?.documentName ??
    domain;

  return (
    <HoverCard closeDelay={0} openDelay={0}>
      <HoverCardTrigger asChild>
        <a
          href={href}
          target={knowledgeCitation ? undefined : "_blank"}
          rel={knowledgeCitation ? undefined : "noopener noreferrer"}
          className="inline-flex items-center"
          onClick={(event) => {
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
          }}
          {...props}
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
      <HoverCardContent className={cn("relative w-80 p-0", props.className)}>
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
