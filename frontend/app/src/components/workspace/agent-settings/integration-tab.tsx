import {
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Link2Icon,
  Loader2Icon,
  PlayIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { AgentSettingsPageText } from "./i18n";
import { FieldLabel, SectionCard } from "./shared";

interface IntegrationTabProps {
  agentStatus: string;
  launchPath: string;
  launchURL: string;
  executionBackend?: string;
  // Export doc
  exportDoc: {
    documentation_url: string;
  } | null;
  exportDocLoading: boolean;
  exportDocError: unknown;
  exportDocMissing: boolean;
  isProdArchive: boolean;
  text: AgentSettingsPageText;
}

export function IntegrationTab({
  agentStatus,
  launchPath,
  launchURL,
  executionBackend,
  exportDoc,
  exportDocLoading,
  exportDocError,
  exportDocMissing,
  isProdArchive,
  text,
}: IntegrationTabProps) {
  async function handleCopyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(text.copyFailed);
    }
  }

  return (
    <div className="space-y-6">
      {/* Launch */}
      <SectionCard
        eyebrow={<Link2Icon className="size-4" />}
        title={text.launchTitle}
        description={text.launchDescription}
      >
        <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
          <FieldLabel className="mb-2">{text.launchUrl}</FieldLabel>
          <code className="bg-background border-border/70 block rounded-2xl border px-3 py-3 text-xs leading-6 break-all">
            {launchURL}
          </code>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={launchPath}>
              <ExternalLinkIcon className="size-3.5" />
              {text.openWorkspace}
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => handleCopyText(launchURL, text.launchUrlCopied)}
          >
            <CopyIcon className="size-3.5" />
            {text.copyUrl}
          </Button>
        </div>
      </SectionCard>

      {/* API Documentation */}
      <SectionCard
        eyebrow={<DownloadIcon className="size-4" />}
        title={text.apiDocTitle}
        description={text.apiDocDescription}
      >
        {exportDocLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            {text.loadingExportDoc}
          </div>
        ) : exportDoc ? (
          <div className="space-y-5">
            {!isProdArchive && (
              <div className="border-border/70 bg-muted/20 rounded-3xl border p-4 text-sm leading-6">
                {text.publishedSource}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              {[
                text.capabilityUploads,
                text.capabilityEvents,
                text.capabilityJson,
              ].map((item) => (
                <div
                  key={item}
                  className="border-border/70 bg-background/70 rounded-3xl border px-4 py-4 text-sm leading-6"
                >
                  {item}
                </div>
              ))}
            </div>

            <div className="border-border/70 rounded-3xl border p-4">
              <FieldLabel className="mb-2">{text.devConsoleUrl}</FieldLabel>
              <code className="bg-background border-border/70 block rounded-2xl border px-3 py-3 text-xs leading-6 break-all">
                {exportDoc.documentation_url}
              </code>
              <p className="mt-4 text-sm leading-6">
                {text.devConsoleDescription}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild>
                  <a
                    href={exportDoc.documentation_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <PlayIcon className="size-3.5" />
                    {text.openPlayground}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    handleCopyText(exportDoc.documentation_url, text.devConsoleUrlCopied)
                  }
                >
                  <CopyIcon className="size-3.5" />
                  {text.copyUrl}
                </Button>
              </div>
            </div>
          </div>
        ) : exportDocMissing ? (
          <p className="text-muted-foreground text-sm leading-6">
            {text.publishFirst}
          </p>
        ) : exportDocError ? (
          <p className="text-sm leading-6">
            {exportDocError instanceof Error ? exportDocError.message : text.loadExportDocFailed}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm leading-6">
            {text.loadExportDocFailed}
          </p>
        )}
      </SectionCard>

      {/* Developer Tools */}
      <SectionCard
        eyebrow={<ExternalLinkIcon className="size-4" />}
        title={text.devToolsTitle}
        description={text.devToolsDescription}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div className="border-border/70 bg-muted/20 rounded-2xl border px-4 py-3">
            <p className="text-sm font-medium">{text.apiCapabilities}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="secondary">{text.conversations}</Badge>
              <Badge variant="secondary">{text.tools}</Badge>
              <Badge variant={agentStatus === "prod" ? "secondary" : "outline"}>
                {text.memory}
              </Badge>
            </div>
          </div>
          <div className="border-border/70 bg-muted/20 rounded-2xl border px-4 py-3">
            <p className="text-sm font-medium">{text.environment}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline" className="capitalize">
                {agentStatus}
              </Badge>
              {executionBackend === "remote" && (
                <Badge variant="outline">Remote</Badge>
              )}
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
