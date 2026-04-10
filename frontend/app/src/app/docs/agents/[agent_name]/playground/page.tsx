import { useParams } from "react-router-dom";

import { usePublicAgentExportDoc } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

import { usePublicAgentOpenAPIDoc } from "../openapi";
import { DeveloperPublicAPIPlayground } from "./developer-playground";
import { getAgentPublicPlaygroundPageText } from "./page.i18n";
import {
  DeveloperDocsShell,
  type DeveloperDocsSidebarSection,
  DocsSectionHeading,
  DocsSurface,
  PublicDocsPageHeading,
  PublicDocsStatePanel,
} from "../shared";

function StepRow({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="grid gap-4 border-t border-slate-200 px-6 py-6 first:border-t-0 lg:grid-cols-[96px_minmax(0,1fr)]">
      <p className="font-mono text-[12px] tracking-[0.18em] text-slate-400 uppercase">
        {step}
      </p>
      <div>
        <h3 className="text-[1rem] font-semibold tracking-[-0.03em] text-slate-950">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-7 text-slate-600">{description}</p>
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
      <div className="space-y-12 pt-2">
        <section id="intro" className="scroll-mt-28 space-y-8">
          <PublicDocsPageHeading
            eyebrow={text.eyebrow}
            title={text.title}
            description={text.description}
          />

          <DocsSurface className="overflow-hidden">
            <div className="grid gap-0 divide-y divide-slate-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
              <div>
                <p className="px-6 pt-6 text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  {text.heroFactOneLabel}
                </p>
                <p className="px-6 pt-2 pb-6 text-sm leading-7 text-slate-700">
                  {text.heroFactOneValue}
                </p>
              </div>
              <div>
                <p className="px-6 pt-6 text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  {text.heroFactTwoLabel}
                </p>
                <p className="px-6 pt-2 pb-6 text-sm leading-7 text-slate-700">
                  {text.heroFactTwoValue}
                </p>
              </div>
              <div>
                <p className="px-6 pt-6 text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  {text.heroFactThreeLabel}
                </p>
                <p className="px-6 pt-2 pb-6 text-sm leading-7 text-slate-700">
                  {text.heroFactThreeValue}
                </p>
              </div>
            </div>
          </DocsSurface>
        </section>

        <DeveloperPublicAPIPlayground
          agentName={exportDoc.agent}
          defaultBaseURL={exportDoc.api_base_url}
        />

        <section
          id="workflow"
          className="scroll-mt-28 space-y-6 border-t border-slate-200 pt-12"
        >
          <DocsSectionHeading
            eyebrow={text.stepsEyebrow}
            title={text.stepsTitle}
            description={text.stepsDescription}
          />

          <DocsSurface className="overflow-hidden">
            <StepRow
              step="01"
              title={text.stepOneTitle}
              description={text.stepOneDescription}
            />
            <StepRow
              step="02"
              title={text.stepTwoTitle}
              description={text.stepTwoDescription}
            />
            <StepRow
              step="03"
              title={text.stepThreeTitle}
              description={text.stepThreeDescription}
            />
          </DocsSurface>
        </section>
      </div>
    </DeveloperDocsShell>
  );
}
