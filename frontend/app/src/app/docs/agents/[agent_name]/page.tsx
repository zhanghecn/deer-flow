import { CopyIcon, ExternalLinkIcon, PlayIcon } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildPublicAgentPlaygroundPath,
  buildPublicAgentReferencePath,
  usePublicAgentExportDoc,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

import { getAgentPublicDocsPageText } from "./page.i18n";

function CopyableCodeBlock({
  code,
  copyLabel,
  copiedLabel,
}: {
  code: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(copiedLabel);
    } catch {
      toast.error(copyLabel);
    }
  }

  return (
    <div className="overflow-hidden rounded-[30px] border border-white/10 bg-slate-950 shadow-[0_24px_80px_-44px_rgba(15,23,42,0.7)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-rose-400/80" />
          <span className="size-2 rounded-full bg-amber-300/80" />
          <span className="size-2 rounded-full bg-emerald-400/80" />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
          onClick={handleCopy}
        >
          <CopyIcon className="size-4" />
          {copyLabel}
        </Button>
      </div>
      <ScrollArea className="h-[280px] px-4 py-4">
        <pre className="font-mono text-xs leading-6 whitespace-pre-wrap text-slate-100">
          {code}
        </pre>
      </ScrollArea>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/70 rounded-[28px] border bg-white/82 px-4 py-4 shadow-[0_20px_60px_-46px_rgba(15,23,42,0.45)] backdrop-blur">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 font-medium break-all">{value}</p>
    </div>
  );
}

function buildJavaScriptSnippet(baseURL: string, agentName: string) {
  return `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAGENTS_API_KEY,
  baseURL: "${baseURL}",
});

const response = await client.responses.create({
  model: "${agentName}",
  input: "Review the uploaded materials and return the top findings.",
});

console.log(response.output_text);`;
}

function buildPythonSnippet(baseURL: string, agentName: string) {
  return `from openai import OpenAI
import os

client = OpenAI(
    api_key=os.environ["OPENAGENTS_API_KEY"],
    base_url="${baseURL}",
)

response = client.responses.create(
    model="${agentName}",
    input="Review the uploaded materials and return the top findings.",
)

print(response.output_text)`;
}

function buildCurlSnippet(baseURL: string, agentName: string) {
  return `curl -N -X POST '${baseURL}/responses' \\
  -H 'Authorization: Bearer <api_key>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "${agentName}",
    "input": [
      {
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "Review the uploaded materials and return the top findings."
          }
        ]
      }
    ],
    "stream": true
  }'`;
}

export default function AgentPublicDocsPage() {
  const { locale } = useI18n();
  const text = getAgentPublicDocsPageText(locale);
  const { agent_name } = useParams<{ agent_name: string }>();
  const { exportDoc, isLoading, error } = usePublicAgentExportDoc(agent_name);

  const javascriptSnippet = useMemo(() => {
    if (!exportDoc) {
      return "";
    }
    return buildJavaScriptSnippet(exportDoc.api_base_url, exportDoc.agent);
  }, [exportDoc]);

  const pythonSnippet = useMemo(() => {
    if (!exportDoc) {
      return "";
    }
    return buildPythonSnippet(exportDoc.api_base_url, exportDoc.agent);
  }, [exportDoc]);

  const curlSnippet = useMemo(() => {
    if (!exportDoc) {
      return "";
    }
    return buildCurlSnippet(exportDoc.api_base_url, exportDoc.agent);
  }, [exportDoc]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.16),transparent_28%),linear-gradient(180deg,#f8fafc,#ffffff)] px-6 py-20">
        <section className="border-border/70 mx-auto max-w-4xl rounded-[40px] border bg-white/90 px-8 py-12 shadow-xs">
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

  if (!exportDoc || error) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.16),transparent_30%),linear-gradient(180deg,#f8fafc,#ffffff)] px-6 py-20">
        <section className="border-border/70 mx-auto max-w-4xl rounded-[40px] border bg-white/90 px-8 py-12 shadow-xs">
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

  const referenceURL =
    exportDoc.reference_url ?? buildPublicAgentReferencePath(exportDoc.agent);
  const playgroundURL =
    exportDoc.playground_url ?? buildPublicAgentPlaygroundPath(exportDoc.agent);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_26%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_18%),linear-gradient(180deg,#f8fafc,#ffffff)]">
      <div className="px-6 py-6 lg:px-8 xl:px-10">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
          className="border-border/70 overflow-hidden rounded-[44px] border bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.12),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] shadow-[0_48px_120px_-70px_rgba(15,23,42,0.4)]"
        >
          <div className="grid gap-10 px-6 py-8 lg:px-10 xl:grid-cols-[minmax(0,1.2fr)_420px] xl:items-end">
            <div className="space-y-7">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="rounded-full px-3 py-1 text-[11px] tracking-[0.2em] uppercase"
                >
                  {text.eyebrow}
                </Badge>
                <Badge variant="secondary">{text.stableContract}</Badge>
              </div>

              <div className="max-w-5xl">
                <h1 className="text-[clamp(2.8rem,5vw,5.4rem)] leading-[0.92] font-semibold tracking-[-0.07em]">
                  <span className="block">{exportDoc.agent}</span>
                  <span className="block">{text.titleSuffix}</span>
                </h1>
                <p className="text-muted-foreground mt-5 max-w-3xl text-base leading-7">
                  {text.description}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild className="rounded-full">
                  <a href={referenceURL}>
                    <ExternalLinkIcon className="size-4" />
                    {text.apiReference}
                  </a>
                </Button>
                <Button variant="outline" asChild className="rounded-full">
                  <a href={playgroundURL}>
                    <PlayIcon className="size-4" />
                    {text.debugPlayground}
                  </a>
                </Button>
                {exportDoc.openapi_url ? (
                  <Button variant="outline" asChild className="rounded-full">
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
                {exportDoc.documentation_json_url ? (
                  <Button variant="ghost" asChild className="rounded-full">
                    <a
                      href={exportDoc.documentation_json_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {text.rawExport}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3">
              <InfoPill label={text.baseURL} value={exportDoc.api_base_url} />
              <InfoPill
                label={text.apiKeyLabel}
                value="Bearer <user_created_key>"
              />
              <InfoPill
                label={text.modelName}
                value={exportDoc.model ?? exportDoc.agent}
              />
            </div>
          </div>
        </motion.section>

        <div className="mx-auto mt-8 max-w-[1440px] space-y-8">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.24 }}
            className="grid gap-6 xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]"
          >
            <div className="border-border/70 rounded-[36px] border bg-white/88 p-6 shadow-xs">
              <p className="text-muted-foreground text-[11px] font-medium tracking-[0.22em] uppercase">
                {text.quickstartTitle}
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
                {text.quickstartDescription}
              </h2>

              <div className="mt-8 space-y-4">
                {[
                  [text.stepOneTitle, text.stepOneDescription],
                  [text.stepTwoTitle, text.stepTwoDescription],
                  [text.stepThreeTitle, text.stepThreeDescription],
                ].map(([title, description]) => (
                  <div
                    key={title}
                    className="border-border/70 bg-background/76 rounded-[28px] border px-5 py-5"
                  >
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-muted-foreground mt-2 text-sm leading-6">
                      {description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-border/70 rounded-[36px] border bg-slate-950 px-6 py-6 text-white shadow-[0_34px_90px_-56px_rgba(15,23,42,0.7)]">
              <p className="text-[11px] font-medium tracking-[0.22em] text-slate-400 uppercase">
                {text.supportTitle}
              </p>
              <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-[-0.04em] text-white">
                {text.supportDescription}
              </h2>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  text.supportStreaming,
                  text.supportFiles,
                  text.supportStructured,
                  text.supportArtifacts,
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-[26px] border border-white/10 bg-white/5 px-4 py-4 text-sm leading-6 text-slate-100"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.24 }}
            className="border-border/70 rounded-[36px] border bg-white/88 p-6 shadow-xs"
          >
            <div className="max-w-3xl">
              <p className="text-muted-foreground text-[11px] font-medium tracking-[0.22em] uppercase">
                {text.snippetTitle}
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
                {text.snippetDescription}
              </h2>
            </div>

            <Tabs defaultValue="javascript" className="mt-6">
              <TabsList className="grid w-full grid-cols-3 rounded-2xl">
                <TabsTrigger value="javascript">{text.jsTab}</TabsTrigger>
                <TabsTrigger value="python">{text.pythonTab}</TabsTrigger>
                <TabsTrigger value="curl">{text.curlTab}</TabsTrigger>
              </TabsList>
              <TabsContent value="javascript" className="mt-4">
                <CopyableCodeBlock
                  code={javascriptSnippet}
                  copyLabel={text.copy}
                  copiedLabel={text.copied}
                />
              </TabsContent>
              <TabsContent value="python" className="mt-4">
                <CopyableCodeBlock
                  code={pythonSnippet}
                  copyLabel={text.copy}
                  copiedLabel={text.copied}
                />
              </TabsContent>
              <TabsContent value="curl" className="mt-4">
                <CopyableCodeBlock
                  code={curlSnippet}
                  copyLabel={text.copy}
                  copiedLabel={text.copied}
                />
              </TabsContent>
            </Tabs>
          </motion.section>
        </div>
      </div>
    </div>
  );
}
