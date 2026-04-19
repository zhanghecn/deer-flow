import { useParams } from "react-router-dom";

import { usePublicAgentExportDoc } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

import { usePublicAgentOpenAPIDoc } from "../openapi";
import {
  DeveloperDocsShell,
  PublicDocsPageHeading,
  PublicDocsStatePanel,
  type DeveloperDocsSidebarSection,
} from "../shared";

import { DeveloperPublicAPIPlayground } from "./developer-playground";
import { getAgentPublicPlaygroundPageText } from "./page.i18n";

function StepItem({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4 py-3 first:pt-0 last:pb-0">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[11px] font-bold text-white">
        {step}
      </span>
      <div>
        <h3 className="text-[13.5px] font-semibold text-zinc-900">{title}</h3>
        <p className="mt-0.5 text-[13px] leading-5 text-zinc-500">
          {description}
        </p>
      </div>
    </div>
  );
}

export default function AgentPublicPlaygroundPage() {
  const { locale } = useI18n();
  const text = getAgentPublicPlaygroundPageText(locale);
  const { agent_name } = useParams<{ agent_name: string }>();
  const { exportDoc, isLoading, error } = usePublicAgentExportDoc(agent_name);
  const {
    openapiURL,
    isLoading: isOpenAPILoading,
    error: openapiError,
  } = usePublicAgentOpenAPIDoc(exportDoc);

  if (isLoading || (exportDoc && isOpenAPILoading)) {
    return (
      <PublicDocsStatePanel
        eyebrow={text.eyebrow}
        title={text.loadingTitle}
        description={text.loadingDescription}
      />
    );
  }

  if (!exportDoc || error) {
    return (
      <PublicDocsStatePanel
        eyebrow={text.eyebrow}
        title={text.loadFailedTitle}
        description={
          error instanceof Error ? error.message : text.loadFailedDescription
        }
        actionLabel={text.openHome}
        actionHref="/"
      />
    );
  }

  if (openapiError) {
    return (
      <PublicDocsStatePanel
        eyebrow={text.eyebrow}
        title={text.referenceFailedTitle}
        description={
          openapiError instanceof Error
            ? openapiError.message
            : text.referenceFailedDescription
        }
        actionLabel={text.openHome}
        actionHref="/"
      />
    );
  }

  const sidebarSections: DeveloperDocsSidebarSection[] = [
    {
      title: text.eyebrow,
      items: [
        { label: text.introNav, href: "#intro" },
        { label: text.connectNav, href: "#connect" },
        { label: text.runNav, href: "#run" },
        { label: text.workflowNav, href: "#workflow" },
      ],
    },
  ];

  return (
    <DeveloperDocsShell
      activeTab="playground"
      agentName={exportDoc.agent}
      openapiURL={openapiURL}
      exportURL={exportDoc.documentation_json_url}
      sidebarSections={sidebarSections}
    >
      <div className="space-y-8">
        <section id="intro" className="scroll-mt-20 space-y-4">
          <PublicDocsPageHeading
            eyebrow={text.eyebrow}
            title={text.title}
            description={text.description}
          />

          <div className="grid gap-0 divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                {text.heroFactOneLabel}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-zinc-600">
                {text.heroFactOneValue}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                {text.heroFactTwoLabel}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-zinc-600">
                {text.heroFactTwoValue}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                {text.heroFactThreeLabel}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-zinc-600">
                {text.heroFactThreeValue}
              </p>
            </div>
          </div>
        </section>

        <section id="connect" className="scroll-mt-20">
          <DeveloperPublicAPIPlayground
            agentName={exportDoc.agent}
            defaultBaseURL={exportDoc.api_base_url}
          />
        </section>

        <section
          id="workflow"
          className="scroll-mt-20 space-y-4 border-t border-zinc-100 pt-10"
        >
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">
              {text.stepsEyebrow}
            </p>
            <h2 className="mt-1.5 text-[18px] font-semibold tracking-tight text-zinc-900">
              {text.stepsTitle}
            </h2>
            <p className="mt-2 text-[13.5px] leading-6 text-zinc-500">
              {text.stepsDescription}
            </p>
          </div>

          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white px-5 py-4">
            <StepItem
              step="01"
              title={text.stepOneTitle}
              description={text.stepOneDescription}
            />
            <StepItem
              step="02"
              title={text.stepTwoTitle}
              description={text.stepTwoDescription}
            />
            <StepItem
              step="03"
              title={text.stepThreeTitle}
              description={text.stepThreeDescription}
            />
          </div>
        </section>
      </div>
    </DeveloperDocsShell>
  );
}
