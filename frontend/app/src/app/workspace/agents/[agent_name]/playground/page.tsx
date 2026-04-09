import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlayIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { PublicAPIPlaygroundPanel } from "@/components/workspace/public-api-playground-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildWorkspaceAgentPath,
  buildWorkspaceAgentSettingsPath,
  readAgentRuntimeSelection,
  useAgentExportDoc,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

import { getAgentPlaygroundPageText } from "./page.i18n";

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/70 bg-background/82 rounded-[24px] border px-4 py-4">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 font-medium break-all">{value}</p>
    </div>
  );
}

function StatePanel({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <section className="border-border/70 bg-background/95 mx-auto max-w-3xl rounded-[32px] border px-6 py-8 text-center shadow-xs">
      <h2 className="text-xl font-semibold tracking-[-0.03em]">{title}</h2>
      <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-sm leading-7">
        {description}
      </p>
      <div className="mt-6 flex justify-center">
        <Button asChild>
          <Link to={actionHref}>
            <ArrowLeftIcon className="size-4" />
            {actionLabel}
          </Link>
        </Button>
      </div>
    </section>
  );
}

export default function AgentPlaygroundPage() {
  const { locale } = useI18n();
  const text = getAgentPlaygroundPageText(locale);
  const { agent_name } = useParams<{ agent_name: string }>();
  const [searchParams] = useSearchParams();
  const runtimeSelection = useMemo(
    // Reuse the same selection parser as settings/chat routes so the
    // standalone playground stays pinned to the exact archive variant.
    () => readAgentRuntimeSelection(searchParams, agent_name),
    [agent_name, searchParams],
  );
  const isProdArchive = runtimeSelection.agentStatus === "prod";
  const settingsPath = useMemo(
    () =>
      buildWorkspaceAgentSettingsPath({
        agentName: runtimeSelection.agentName,
        agentStatus: runtimeSelection.agentStatus,
        executionBackend: runtimeSelection.executionBackend,
        remoteSessionId: runtimeSelection.remoteSessionId,
      }),
    [
      runtimeSelection.agentName,
      runtimeSelection.agentStatus,
      runtimeSelection.executionBackend,
      runtimeSelection.remoteSessionId,
    ],
  );
  const launchPath = useMemo(
    () =>
      buildWorkspaceAgentPath({
        agentName: runtimeSelection.agentName,
        agentStatus: runtimeSelection.agentStatus,
        executionBackend: runtimeSelection.executionBackend,
        remoteSessionId: runtimeSelection.remoteSessionId,
      }),
    [
      runtimeSelection.agentName,
      runtimeSelection.agentStatus,
      runtimeSelection.executionBackend,
      runtimeSelection.remoteSessionId,
    ],
  );
  const { exportDoc, isLoading, error } = useAgentExportDoc(
    runtimeSelection.agentName,
    isProdArchive,
  );

  return (
    <div className="min-h-full overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.08),transparent_24%),linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,1))]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-6 py-6 lg:px-8 xl:px-10">
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="border-border/70 overflow-hidden rounded-[36px] border bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.98))] shadow-xs"
        >
          <div className="grid gap-6 px-6 py-6 lg:px-8 xl:grid-cols-[minmax(0,1.15fr)_420px]">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="rounded-full"
                >
                  <Link to={settingsPath}>
                    <ArrowLeftIcon className="size-4" />
                    {text.backToSettings}
                  </Link>
                </Button>
                <Badge variant="outline" className="capitalize">
                  {runtimeSelection.agentStatus}
                </Badge>
                {exportDoc?.model ? (
                  <Badge variant="secondary">{exportDoc.model}</Badge>
                ) : null}
              </div>

              <div className="max-w-4xl">
                <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                  {text.eyebrow}
                </p>
                <h1 className="mt-3 text-[clamp(2rem,4vw,3.6rem)] leading-[0.98] font-semibold tracking-[-0.05em]">
                  <span className="block">{runtimeSelection.agentName}</span>
                  <span className="block">{text.titleSuffix}</span>
                </h1>
                <p className="text-muted-foreground mt-3 max-w-3xl text-base leading-7">
                  {text.description}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link to={launchPath}>
                    <PlayIcon className="size-4" />
                    {text.openAgent}
                  </Link>
                </Button>
                {exportDoc ? (
                  <Button variant="outline" asChild>
                    <a
                      href={
                        exportDoc.reference_url ?? exportDoc.documentation_url
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLinkIcon className="size-4" />
                      {text.openDocs}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <InfoTile
                label={text.publishedAgent}
                value={runtimeSelection.agentName}
              />
              <InfoTile
                label={text.currentArchive}
                value={runtimeSelection.agentStatus}
              />
              <InfoTile
                label={text.gatewayBase}
                value={
                  exportDoc?.gateway_base_url ??
                  exportDoc?.api_base_url ??
                  "/v1"
                }
              />
              <InfoTile label={text.contracts} value={text.contractsValue} />
            </div>
          </div>
        </motion.header>

        {!isProdArchive ? (
          <StatePanel
            title={text.productionOnlyTitle}
            description={text.productionOnlyDescription}
            actionLabel={text.returnToSettings}
            actionHref={settingsPath}
          />
        ) : isLoading ? (
          <section className="border-border/70 bg-background/95 rounded-[32px] border px-6 py-10 shadow-xs">
            <div className="text-muted-foreground flex items-center justify-center gap-3 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              <span>{text.loadingTitle}</span>
            </div>
            <p className="text-muted-foreground mt-3 text-center text-sm leading-6">
              {text.loadingDescription}
            </p>
          </section>
        ) : error || !exportDoc ? (
          <StatePanel
            title={text.loadFailedTitle}
            description={
              error instanceof Error
                ? error.message
                : text.loadFailedDescription
            }
            actionLabel={text.returnToSettings}
            actionHref={settingsPath}
          />
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04, duration: 0.24 }}
            >
              <PublicAPIPlaygroundPanel
                agentName={runtimeSelection.agentName}
                defaultBaseURL={exportDoc.api_base_url}
                documentationURL={
                  exportDoc.reference_url ?? exportDoc.documentation_url
                }
              />
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
