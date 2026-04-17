import { useParams } from "react-router-dom";

import { usePublicAgentExportDoc } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

import { usePublicAgentOpenAPIDoc } from "../openapi";
import {
  DeveloperDocsShell,
  type DeveloperDocsSidebarSection,
  PublicDocsStatePanel,
} from "../shared";

import { getAgentPublicSupportPageText } from "./page.i18n";
import { SupportHTTPChatDemo } from "./support-sdk-chat-demo";

export default function AgentPublicSupportPage() {
  const { locale } = useI18n();
  const text = getAgentPublicSupportPageText(locale);
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
        eyebrow={text.title}
        title={text.loadingTitle}
        description={text.loadingDescription}
      />
    );
  }

  if (!exportDoc || error) {
    return (
      <PublicDocsStatePanel
        eyebrow={text.title}
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
        eyebrow={text.title}
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
      title: text.title,
      items: [
        { label: text.introNav, href: "#support" },
        { label: text.consoleNav, href: "#console" },
        { label: text.activityNav, href: "#activity" },
      ],
    },
  ];

  return (
    <DeveloperDocsShell
      activeTab="support"
      agentName={exportDoc.agent}
      openapiURL={openapiURL}
      exportURL={exportDoc.documentation_json_url}
      sidebarSections={sidebarSections}
    >
      <div className="space-y-6 pt-2">
        <section id="support" className="max-w-3xl scroll-mt-28 space-y-3">
          <h1 className="text-[1.85rem] font-semibold tracking-[-0.04em] text-slate-950">
            {text.title}
          </h1>
          <p className="text-sm leading-7 text-slate-600">{text.description}</p>
        </section>

        <SupportHTTPChatDemo
          agentName={exportDoc.agent}
          defaultBaseURL={exportDoc.api_base_url}
        />
      </div>
    </DeveloperDocsShell>
  );
}
