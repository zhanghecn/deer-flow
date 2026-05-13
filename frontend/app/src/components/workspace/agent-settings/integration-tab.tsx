import {
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Link2Icon,
  Loader2Icon,
  PlayIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import type { AgentSettingsPageText } from "./i18n";
import { FieldLabel, SectionCard } from "./shared";
import type { AgentSettingsFormState } from "./types";

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
  form: AgentSettingsFormState;
  text: AgentSettingsPageText;
  onFormChange: (
    updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null,
  ) => void;
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
  form,
  text,
  onFormChange,
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

      {/* Public API Auth */}
      <SectionCard
        eyebrow={<KeyRoundIcon className="size-4" />}
        title={text.publicApiAuthTitle}
        description={text.publicApiAuthDescription}
      >
        <div className="border-border/70 bg-muted/20 flex items-start justify-between gap-4 rounded-2xl border px-4 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">
                {form.publicApiAuthMode === "trusted_external"
                  ? text.publicApiTrustedExternal
                  : text.publicApiKeyRequired}
              </p>
              <Badge variant="outline">
                {form.publicApiAuthMode === "trusted_external"
                  ? text.publicApiTrustedBadge
                  : text.publicApiKeyBadge}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              {form.publicApiAuthMode === "trusted_external"
                ? text.publicApiTrustedExternalDescription
                : text.publicApiKeyRequiredDescription}
            </p>
          </div>
          <Switch
            checked={form.publicApiAuthMode === "trusted_external"}
            aria-label={text.publicApiAuthTitle}
            onCheckedChange={(checked) =>
              onFormChange((current) => ({
                ...current,
                publicApiAuthMode: checked
                  ? "trusted_external"
                  : "api_key_required",
              }))
            }
          />
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
