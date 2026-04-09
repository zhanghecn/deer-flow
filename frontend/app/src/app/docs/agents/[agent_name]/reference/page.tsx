import { ApiReferenceReact } from "@scalar/api-reference-react";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildPublicAgentDocsPath,
  buildPublicAgentPlaygroundPath,
  usePublicAgentExportDoc,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

import { getAgentPublicReferencePageText } from "./page.i18n";

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/70 rounded-[24px] border bg-white/82 px-4 py-4 shadow-xs">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 font-medium break-all">{value}</p>
    </div>
  );
}

export default function AgentPublicReferencePage() {
  const { locale } = useI18n();
  const text = getAgentPublicReferencePageText(locale);
  const { agent_name } = useParams<{ agent_name: string }>();
  const { exportDoc, isLoading, error } = usePublicAgentExportDoc(agent_name);

  const scalarConfiguration = useMemo(() => {
    if (!exportDoc) {
      return null;
    }
    // The backend-generated OpenAPI document is the stable contract source.
    // Scalar is only the renderer so UI iterations do not redefine the API.
    return {
      url:
        exportDoc.openapi_url ??
        `/open/agents/${encodeURIComponent(exportDoc.agent)}/openapi.json`,
      theme: "saturn" as const,
      layout: "modern" as const,
      forceDarkModeState: "light" as const,
      hideDarkModeToggle: true,
      persistAuth: true,
      searchHotKey: "k" as const,
    };
  }, [exportDoc]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),transparent_28%),linear-gradient(180deg,#f8fafc,#ffffff)] px-6 py-20">
        <section className="border-border/70 mx-auto max-w-4xl rounded-[36px] border bg-white/90 px-8 py-12 shadow-xs">
          <p className="text-muted-foreground text-[11px] font-medium tracking-[0.22em] uppercase">
            {text.eyebrow}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em]">
            {text.loadingTitle}
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-7">
            {text.loadingDescription}
          </p>
        </section>
      </div>
    );
  }

  if (!exportDoc || error || !scalarConfiguration) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.16),transparent_28%),linear-gradient(180deg,#f8fafc,#ffffff)] px-6 py-20">
        <section className="border-border/70 mx-auto max-w-4xl rounded-[36px] border bg-white/90 px-8 py-12 shadow-xs">
          <p className="text-muted-foreground text-[11px] font-medium tracking-[0.22em] uppercase">
            {text.eyebrow}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em]">
            {text.loadFailedTitle}
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-7">
            {error instanceof Error
              ? error.message
              : text.loadFailedDescription}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/">{text.openHome}</Link>
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const docsHomeURL =
    exportDoc.documentation_url ?? buildPublicAgentDocsPath(exportDoc.agent);
  const playgroundURL =
    exportDoc.playground_url ?? buildPublicAgentPlaygroundPath(exportDoc.agent);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_24%),linear-gradient(180deg,#f8fafc,#ffffff)]">
      <div className="px-6 py-6 lg:px-8 xl:px-10">
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
          className="border-border/70 overflow-hidden rounded-[40px] border bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.14),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.98))] shadow-[0_32px_100px_-68px_rgba(15,23,42,0.4)]"
        >
          <div className="grid gap-6 px-6 py-7 lg:px-8 xl:grid-cols-[minmax(0,1.15fr)_420px]">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="rounded-full px-3 py-1 text-[11px] tracking-[0.2em] uppercase"
                >
                  {text.eyebrow}
                </Badge>
                <Badge variant="secondary">{text.stableContract}</Badge>
              </div>

              <div className="max-w-4xl">
                <h1 className="text-[clamp(2.3rem,4vw,4.8rem)] leading-[0.94] font-semibold tracking-[-0.06em]">
                  <span className="block">{exportDoc.agent}</span>
                  <span className="block">{text.titleSuffix}</span>
                </h1>
                <p className="text-muted-foreground mt-4 max-w-3xl text-base leading-7">
                  {text.description}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" asChild className="rounded-full">
                  <a href={docsHomeURL}>{text.backDocs}</a>
                </Button>
                <Button asChild className="rounded-full">
                  <a href={playgroundURL}>
                    <PlayIcon className="size-4" />
                    {text.openPlayground}
                  </a>
                </Button>
                {exportDoc.openapi_url ? (
                  <Button variant="ghost" asChild className="rounded-full">
                    <a
                      href={exportDoc.openapi_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLinkIcon className="size-4" />
                      {text.rawOpenAPI}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3">
              <InfoPill label={text.baseURL} value={exportDoc.api_base_url} />
              <InfoPill
                label={text.modelName}
                value={exportDoc.model ?? exportDoc.agent}
              />
            </div>
          </div>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.24 }}
          className="border-border/70 mt-8 overflow-hidden rounded-[36px] border bg-white shadow-[0_32px_100px_-72px_rgba(15,23,42,0.4)]"
        >
          <ApiReferenceReact configuration={scalarConfiguration} />
        </motion.section>
      </div>
    </div>
  );
}
