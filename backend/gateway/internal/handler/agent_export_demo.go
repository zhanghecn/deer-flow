package handler

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func resolvePublicGatewayBaseURL(c *gin.Context) string {
	if explicit := strings.TrimSpace(os.Getenv("OPENAGENTS_PUBLIC_GATEWAY_URL")); explicit != "" {
		return strings.TrimRight(explicit, "/")
	}

	scheme := "http"
	if forwardedProto := strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-Proto"), ",")[0]); forwardedProto != "" {
		scheme = forwardedProto
	} else if c.Request.TLS != nil {
		scheme = "https"
	}

	host := strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-Host"), ",")[0])
	if host == "" {
		host = strings.TrimSpace(c.Request.Host)
	}

	switch {
	case strings.HasSuffix(host, ":3000"):
		host = strings.TrimSuffix(host, ":3000") + ":8001"
	case strings.HasSuffix(host, ":5173"):
		host = strings.TrimSuffix(host, ":5173") + ":8001"
	}

	return strings.TrimRight(fmt.Sprintf("%s://%s", scheme, host), "/")
}

func sanitizeDemoName(name string) string {
	replacer := strings.NewReplacer("_", "-", " ", "-")
	normalized := replacer.Replace(strings.ToLower(strings.TrimSpace(name)))
	if normalized == "" {
		return "openagents-agent"
	}
	return normalized
}

func buildReactDemoArchive(
	agentName string,
	baseURL string,
	apiToken string,
	expiresAt time.Time,
	exportDoc gin.H,
) ([]byte, error) {
	var buffer bytes.Buffer
	zipWriter := zip.NewWriter(&buffer)

	files := map[string]string{
		"README.md":              demoReadmeTemplate(agentName, baseURL, expiresAt),
		".gitignore":             "node_modules\ndist\n.env.local\n",
		".env.local":             demoEnvTemplate(agentName, baseURL, apiToken),
		".env.example":           "VITE_OPENAGENTS_BASE_URL=http://localhost:8001\nVITE_OPENAGENTS_AGENT_NAME=" + agentName + "\nVITE_OPENAGENTS_API_TOKEN=df_your_token_here\n",
		"package.json":           demoPackageJSON(agentName),
		"vite.config.js":         demoViteConfig(),
		"index.html":             demoIndexHTML(agentName),
		"src/main.jsx":           demoMainJSX(),
		"src/App.jsx":            demoAppJSX(agentName),
		"src/styles.css":         demoStylesCSS(),
		"openagents-export.json": mustJSONString(exportDoc),
	}

	for path, content := range files {
		if err := writeZipTextFile(zipWriter, path, content); err != nil {
			return nil, err
		}
	}

	if err := zipWriter.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func writeZipTextFile(zipWriter *zip.Writer, path string, content string) error {
	writer, err := zipWriter.Create(path)
	if err != nil {
		return err
	}
	_, err = writer.Write([]byte(content))
	return err
}

func mustJSONString(value any) string {
	encoded, err := jsonMarshalIndent(value)
	if err != nil {
		return "{}\n"
	}
	return encoded
}

func jsonMarshalIndent(value any) (string, error) {
	bytesValue, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "", err
	}
	return string(bytesValue) + "\n", nil
}

func demoReadmeTemplate(agentName string, baseURL string, expiresAt time.Time) string {
	return fmt.Sprintf(`# %s React Demo

This project is a standalone React + Vite demo for the published OpenAgents agent %q.

## Included configuration

- Base URL: %s
- Agent: %s
- Token expiry: %s

## Run locally

1. pnpm install
2. pnpm dev
3. Open the URL printed by Vite

## Notes

- The generated token is already written into .env.local.
- Do not commit .env.local to source control.
- If your gateway is reachable on a different host, update VITE_OPENAGENTS_BASE_URL in .env.local.
- The app uses the synchronous /open/v1/agents/:name/chat endpoint and waits for the final thread state.
- Artifact previews and downloads go through the Open API artifact route with the embedded token.
- Office files use the gateway PDF preview when available, so PPTX and DOCX outputs remain viewable outside the main workspace.
`, agentName, agentName, baseURL, agentName, expiresAt.Format(time.RFC3339))
}

func demoEnvTemplate(agentName string, baseURL string, apiToken string) string {
	return fmt.Sprintf(
		"VITE_OPENAGENTS_BASE_URL=%s\nVITE_OPENAGENTS_AGENT_NAME=%s\nVITE_OPENAGENTS_API_TOKEN=%s\n",
		baseURL,
		agentName,
		apiToken,
	)
}

func demoPackageJSON(agentName string) string {
	return fmt.Sprintf(`{
  "name": "%s-react-demo",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5174",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0 --port 4174"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.1.1",
    "vite": "^7.3.1"
  }
}
`, sanitizeDemoName(agentName))
}

func demoViteConfig() string {
	return `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`
}

func demoIndexHTML(agentName string) string {
	return fmt.Sprintf(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>%s Demo</title>
    <script type="module" src="/src/main.jsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`, agentName)
}

func demoMainJSX() string {
	return `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`
}

func demoAppJSX(agentName string) string {
	return fmt.Sprintf(`import { useEffect, useState } from "react";

const baseUrl = (import.meta.env.VITE_OPENAGENTS_BASE_URL || "").replace(/\/+$/, "");
const agentName = import.meta.env.VITE_OPENAGENTS_AGENT_NAME || %q;
const apiToken = import.meta.env.VITE_OPENAGENTS_API_TOKEN || "";

const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const VIDEO_FILE_RE = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO_FILE_RE = /\.(mp3|wav|m4a|ogg)$/i;
const TEXT_FILE_RE = /\.(md|txt|json|ya?ml|csv|xml|log|py|js|ts|tsx|jsx|css|html?)$/i;
const OFFICE_FILE_RE = /\.(doc|docx|ppt|pptx)$/i;

function getFileName(filepath) {
  const segments = String(filepath || "").split("/").filter(Boolean);
  return segments[segments.length - 1] || filepath;
}

function getArtifactKind(filepath) {
  const normalized = String(filepath || "").toLowerCase();
  if (IMAGE_FILE_RE.test(normalized)) return "image";
  if (VIDEO_FILE_RE.test(normalized)) return "video";
  if (AUDIO_FILE_RE.test(normalized)) return "audio";
  if (OFFICE_FILE_RE.test(normalized)) return "office";
  if (normalized.endsWith(".pdf")) return "pdf";
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) return "html";
  if (TEXT_FILE_RE.test(normalized)) return "text";
  return "binary";
}

function encodeArtifactPath(filepath) {
  return String(filepath || "")
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildArtifactURL(base, currentAgentName, currentThreadId, filepath, preview) {
  if (!base || !currentAgentName || !currentThreadId || !filepath) {
    return "";
  }

  const params = new URLSearchParams();
  if (preview) {
    params.set("preview", preview);
  }
  const query = params.toString();

  return (
    base +
    "/open/v1/agents/" +
    currentAgentName +
    "/threads/" +
    currentThreadId +
    "/artifacts/" +
    encodeArtifactPath(filepath) +
    (query ? "?" + query : "")
  );
}

function extractTextParts(content) {
  if (typeof content === "string") {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((part) => part && typeof part === "object" && part.type === "text")
    .map((part) => part.text)
    .filter((text) => typeof text === "string" && text.trim().length > 0);
}

function latestAssistantText(messages) {
  if (!Array.isArray(messages)) {
    return "";
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "ai") {
      continue;
    }

    const text = extractTextParts(message.content).join("\n").trim();
    if (text) {
      return text;
    }
  }

  return "";
}

export default function App() {
  const [message, setMessage] = useState("请介绍一下这个 agent 能做什么。");
  const [threadId, setThreadId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [selectedArtifact, setSelectedArtifact] = useState("");
  const [artifactPreview, setArtifactPreview] = useState(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState("");
  const endpoint = baseUrl
    ? baseUrl + "/open/v1/agents/" + agentName + "/chat"
    : "";

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiToken,
        },
        body: JSON.stringify({
          message,
          thread_id: threadId || undefined,
        }),
      });

      const nextThreadId = response.headers.get("X-Thread-ID") || threadId;
      if (nextThreadId) {
        setThreadId(nextThreadId);
      }

      const text = await response.text();
      let parsed = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Keep the raw text when the upstream returns plain text / SSE fragments.
      }

      if (!response.ok) {
        throw new Error(
          typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2),
        );
      }

      const artifacts = Array.isArray(parsed?.artifacts) ? parsed.artifacts : [];

      setResult({
        status: response.status,
        threadId: nextThreadId || null,
        body: parsed,
        assistantText: latestAssistantText(parsed?.messages),
        artifacts,
      });
      setSelectedArtifact(artifacts[0] || "");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : String(submitError),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedArtifact || !result?.threadId || !apiToken) {
      setArtifactPreview(null);
      setArtifactError("");
      setArtifactLoading(false);
      return undefined;
    }

    let cancelled = false;
    let objectUrl = "";

    async function loadArtifactPreview() {
      const rawKind = getArtifactKind(selectedArtifact);
      const previewMode = rawKind === "office" ? "pdf" : undefined;
      const resolvedKind = rawKind === "office" ? "pdf" : rawKind;
      const url = buildArtifactURL(
        baseUrl,
        agentName,
        result.threadId,
        selectedArtifact,
        previewMode,
      );

      if (!url) {
        throw new Error("Missing artifact URL.");
      }

      const response = await fetch(url, {
        headers: {
          Authorization: "Bearer " + apiToken,
        },
      });
      if (!response.ok) {
        const text = await response.text();
        if (rawKind === "office") {
          if (cancelled) {
            return;
          }
          setArtifactPreview({
            kind: "binary",
            name: getFileName(selectedArtifact),
            message:
              "Office preview is unavailable on this gateway. Use the download button, or install LibreOffice/soffice to enable PDF previews.",
          });
          return;
        }
        throw new Error(text || "Failed to load artifact preview.");
      }

      if (resolvedKind === "text" || resolvedKind === "html") {
        const text = await response.text();
        if (cancelled) {
          return;
        }
        setArtifactPreview({
          kind: resolvedKind,
          text,
          name: getFileName(selectedArtifact),
        });
        return;
      }

      if (resolvedKind === "binary") {
        if (cancelled) {
          return;
        }
        setArtifactPreview({
          kind: "binary",
          name: getFileName(selectedArtifact),
          message:
            "Preview is not available for this file type yet. Use the download button.",
        });
        return;
      }

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      if (cancelled) {
        return;
      }
      setArtifactPreview({
        kind: resolvedKind,
        url: objectUrl,
        name: getFileName(selectedArtifact),
      });
    }

    setArtifactLoading(true);
    setArtifactError("");
    setArtifactPreview(null);

    void loadArtifactPreview()
      .catch((previewError) => {
        if (cancelled) {
          return;
        }
        setArtifactError(
          previewError instanceof Error
            ? previewError.message
            : String(previewError),
        );
      })
      .finally(() => {
        if (!cancelled) {
          setArtifactLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [apiToken, baseUrl, result?.threadId, selectedArtifact]);

  async function handleDownload(filepath) {
    if (!result?.threadId) {
      return;
    }

    const url = buildArtifactURL(baseUrl, agentName, result.threadId, filepath);
    const response = await fetch(url, {
      headers: {
        Authorization: "Bearer " + apiToken,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Failed to download artifact.");
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = getFileName(filepath);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <main className="demo-shell">
      <section className="hero-card">
        <p className="eyebrow">OpenAgents Export Demo</p>
        <h1>{agentName}</h1>
        <p className="lede">
          This standalone demo waits for the final agent response, keeps the
          thread for multi-turn usage, and can preview or download generated
          artifacts without the main workspace UI.
        </p>
        <div className="meta-grid">
          <div>
            <span>Gateway</span>
            <code>{baseUrl || "missing VITE_OPENAGENTS_BASE_URL"}</code>
          </div>
          <div>
            <span>Token</span>
            <code>
              {apiToken
                ? apiToken.slice(0, 8) + "..." + apiToken.slice(-4)
                : "missing"}
            </code>
          </div>
        </div>
      </section>

      <div className="workspace-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Conversation</p>
              <h2>Call The Published Agent</h2>
            </div>
            {result?.threadId ? (
              <span className="pill">thread: {result.threadId}</span>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} className="form-stack">
            <label>
              <span>Message</span>
              <textarea
                rows={7}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ask the exported agent to answer or generate files"
              />
            </label>

            <label>
              <span>Thread ID (optional)</span>
              <input
                value={threadId}
                onChange={(event) => setThreadId(event.target.value)}
                placeholder="Reuse a thread id if you want multi-turn behavior"
              />
            </label>

            <div className="button-row">
              <button type="submit" disabled={loading || !endpoint || !apiToken}>
                {loading ? "Waiting For Final State..." : "Call Agent"}
              </button>
            </div>
          </form>

          {error ? <pre className="error-box">{error}</pre> : null}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Assistant</p>
              <h2>Final Response</h2>
            </div>
            {result ? (
              <span className="pill">
                {result.artifacts.length} artifact
                {result.artifacts.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          {!result ? (
            <p className="placeholder">No response yet.</p>
          ) : (
            <>
              <div className="response-card">
                <pre className="response-text">
                  {result.assistantText || "No assistant text returned."}
                </pre>
              </div>
              <details className="debug-details">
                <summary>Raw JSON</summary>
                <pre className="result-box">
                  {JSON.stringify(result.body, null, 2)}
                </pre>
              </details>
            </>
          )}
        </section>

        <section className="panel artifact-panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Artifacts</p>
              <h2>Preview And Download</h2>
            </div>
            {selectedArtifact ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void handleDownload(selectedArtifact).catch((downloadError) => {
                    setArtifactError(
                      downloadError instanceof Error
                        ? downloadError.message
                        : String(downloadError),
                    );
                  });
                }}
              >
                Download Selected
              </button>
            ) : null}
          </div>

          {!result?.artifacts?.length ? (
            <p className="placeholder">
              Ask the agent to generate a file, then its artifact list will appear here.
            </p>
          ) : (
            <div className="artifact-layout">
              <div className="artifact-list">
                {result.artifacts.map((filepath) => (
                  <button
                    key={filepath}
                    type="button"
                    className={
                      "artifact-chip" +
                      (filepath === selectedArtifact ? " active" : "")
                    }
                    onClick={() => setSelectedArtifact(filepath)}
                  >
                    <strong>{getFileName(filepath)}</strong>
                    <span>{filepath}</span>
                  </button>
                ))}
              </div>

              <div className="artifact-preview">
                {artifactLoading ? (
                  <p className="placeholder">Loading preview...</p>
                ) : null}
                {!artifactLoading && artifactError ? (
                  <pre className="error-box">{artifactError}</pre>
                ) : null}
                {!artifactLoading && !artifactError && !artifactPreview ? (
                  <p className="placeholder">
                    Select an artifact to preview its contents.
                  </p>
                ) : null}
                {!artifactLoading &&
                !artifactError &&
                artifactPreview?.kind === "text" ? (
                  <pre className="artifact-text">{artifactPreview.text}</pre>
                ) : null}
                {!artifactLoading &&
                !artifactError &&
                artifactPreview?.kind === "html" ? (
                  <iframe
                    title={artifactPreview.name}
                    className="artifact-frame"
                    srcDoc={artifactPreview.text}
                  />
                ) : null}
                {!artifactLoading &&
                !artifactError &&
                artifactPreview?.kind === "image" ? (
                  <img
                    className="artifact-image"
                    src={artifactPreview.url}
                    alt={artifactPreview.name}
                  />
                ) : null}
                {!artifactLoading &&
                !artifactError &&
                artifactPreview?.kind === "video" ? (
                  <video className="artifact-media" controls src={artifactPreview.url} />
                ) : null}
                {!artifactLoading &&
                !artifactError &&
                artifactPreview?.kind === "audio" ? (
                  <audio className="artifact-audio" controls src={artifactPreview.url} />
                ) : null}
                {!artifactLoading &&
                !artifactError &&
                artifactPreview?.kind === "pdf" ? (
                  <iframe
                    title={artifactPreview.name}
                    className="artifact-frame"
                    src={artifactPreview.url}
                  />
                ) : null}
                {!artifactLoading &&
                !artifactError &&
                artifactPreview?.kind === "binary" ? (
                  <p className="placeholder">
                    {artifactPreview.message ||
                      "Preview is not available for this file type yet. Use the download button."}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
`, agentName)
}

func demoStylesCSS() string {
	return `:root {
  color-scheme: light;
  font-family: "IBM Plex Sans", "Avenir Next", "PingFang SC", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(255, 179, 71, 0.22), transparent 28%),
    radial-gradient(circle at top right, rgba(15, 118, 110, 0.18), transparent 30%),
    linear-gradient(180deg, #f8f5ef 0%, #f3f7f5 48%, #ffffff 100%);
  color: #172033;
  --panel-border: rgba(23, 32, 51, 0.08);
  --panel-shadow: 0 24px 80px rgba(23, 32, 51, 0.08);
  --panel-bg: rgba(255, 255, 255, 0.9);
  --accent: #0f766e;
  --ink-soft: #52607a;
  --surface-strong: #0f172a;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

code,
pre,
textarea,
input {
  font-family: "SFMono-Regular", "Consolas", "IBM Plex Mono", monospace;
}

.demo-shell {
  width: min(1380px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 28px 0 64px;
  display: grid;
  gap: 24px;
}

.hero-card,
.panel {
  border: 1px solid var(--panel-border);
  border-radius: 28px;
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
  padding: 24px;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: clamp(28px, 3vw, 44px);
  line-height: 1.05;
  letter-spacing: -0.04em;
}

h2 {
  font-size: 20px;
  line-height: 1.2;
}

.lede {
  margin-top: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
  max-width: 760px;
}

.meta-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  margin-top: 20px;
}

.workspace-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(320px, 0.95fr) minmax(320px, 1.05fr);
}

.artifact-panel {
  grid-column: 1 / -1;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.section-kicker {
  margin-bottom: 6px;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.meta-grid div,
label {
  display: grid;
  gap: 8px;
}

.meta-grid span,
label span {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

textarea,
input {
  width: 100%;
  border: 1px solid rgba(23, 32, 51, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.95);
  padding: 14px 16px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--surface-strong);
}

textarea {
  resize: vertical;
  min-height: 180px;
}

.form-stack {
  display: grid;
  gap: 16px;
}

.button-row {
  display: flex;
  justify-content: flex-end;
}

button {
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #14532d 0%, #0f766e 100%);
  color: white;
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 120ms ease,
    opacity 120ms ease,
    box-shadow 120ms ease;
  box-shadow: 0 14px 28px rgba(15, 118, 110, 0.24);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  box-shadow: none;
}

button:not(:disabled):hover {
  transform: translateY(-1px);
}

.ghost-button {
  background: rgba(15, 118, 110, 0.1);
  color: var(--accent);
  box-shadow: none;
  padding-inline: 16px;
}

.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.12);
  padding: 6px 10px;
  font-size: 12px;
  color: var(--accent);
}

.placeholder {
  color: var(--ink-soft);
  line-height: 1.7;
}

.error-box,
.result-box,
.artifact-text,
.response-text {
  margin: 0;
  border-radius: 18px;
  padding: 16px;
  overflow: auto;
  background: #0f172a;
  color: #e2e8f0;
}

.error-box {
  background: #450a0a;
  color: #fecaca;
}

.response-card {
  border: 1px solid rgba(23, 32, 51, 0.08);
  border-radius: 22px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), rgba(255, 179, 71, 0.12)),
    rgba(255, 255, 255, 0.9);
  padding: 18px;
}

.response-text {
  min-height: 220px;
  background: rgba(248, 250, 252, 0.82);
  color: var(--surface-strong);
  white-space: pre-wrap;
}

.debug-details {
  margin-top: 16px;
}

.debug-details summary {
  cursor: pointer;
  color: var(--ink-soft);
  font-weight: 600;
  margin-bottom: 12px;
}

.result-box {
  min-height: 200px;
}

.artifact-layout {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
}

.artifact-list {
  display: grid;
  gap: 12px;
  align-content: start;
}

.artifact-chip {
  width: 100%;
  border: 1px solid rgba(23, 32, 51, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: none;
  color: var(--surface-strong);
  padding: 14px 16px;
  text-align: left;
}

.artifact-chip strong,
.artifact-chip span {
  display: block;
}

.artifact-chip strong {
  font-size: 14px;
}

.artifact-chip span {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
}

.artifact-chip.active {
  border-color: rgba(15, 118, 110, 0.32);
  background: linear-gradient(135deg, rgba(15, 118, 110, 0.12), rgba(255, 179, 71, 0.14));
}

.artifact-preview {
  min-height: 480px;
  border: 1px dashed rgba(23, 32, 51, 0.14);
  border-radius: 24px;
  background: rgba(248, 250, 252, 0.74);
  padding: 18px;
  display: grid;
  align-items: stretch;
}

.artifact-text {
  min-height: 420px;
  white-space: pre-wrap;
}

.artifact-frame,
.artifact-image,
.artifact-media {
  width: 100%;
  min-height: 420px;
  border: none;
  border-radius: 18px;
  background: white;
}

.artifact-image {
  object-fit: contain;
}

.artifact-audio {
  width: 100%;
  align-self: center;
}

@media (max-width: 720px) {
  .demo-shell {
    width: min(100vw - 20px, 100%);
    padding-top: 20px;
  }

  .workspace-grid,
  .artifact-layout {
    grid-template-columns: 1fr;
  }

  .hero-card,
  .panel {
    padding: 18px;
  }

  .panel-header {
    flex-direction: column;
  }

  button {
    width: 100%;
  }
}
`
}
