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
- The app uses the synchronous /open/v1/agents/:name/chat endpoint for the shortest local smoke-test path.
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
	return fmt.Sprintf(`import { useMemo, useState } from "react";

const baseUrl = (import.meta.env.VITE_OPENAGENTS_BASE_URL || "").replace(/\/+$/, "");
const agentName = import.meta.env.VITE_OPENAGENTS_AGENT_NAME || %q;
const apiToken = import.meta.env.VITE_OPENAGENTS_API_TOKEN || "";

export default function App() {
  const [message, setMessage] = useState("请介绍一下这个 agent 能做什么。");
  const [threadId, setThreadId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const endpoint = useMemo(
    () =>
      baseUrl
        ? baseUrl + "/open/v1/agents/" + agentName + "/chat"
        : "",
    [baseUrl],
  );

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

      setResult({
        status: response.status,
        threadId: nextThreadId || null,
        body: parsed,
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : String(submitError),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">OpenAgents React Demo</p>
        <h1>{agentName}</h1>
        <p className="lede">
          This standalone demo calls the published agent through the Open API.
          Update the prompt below and submit a real request from your local machine.
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

      <section className="panel">
        <form onSubmit={handleSubmit} className="form-stack">
          <label>
            <span>Message</span>
            <textarea
              rows={6}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Send a real request to the published agent"
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
              {loading ? "Calling agent..." : "Call agent"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="result-header">
          <h2>Response</h2>
          {result?.threadId ? (
            <span className="pill">thread: {result.threadId}</span>
          ) : null}
        </div>
        {error ? <pre className="error-box">{error}</pre> : null}
        {!error && !result ? (
          <p className="placeholder">No response yet.</p>
        ) : null}
        {result ? (
          <pre className="result-box">{JSON.stringify(result, null, 2)}</pre>
        ) : null}
      </section>
    </main>
  );
}
`, agentName)
}

func demoStylesCSS() string {
	return `:root {
  color-scheme: light;
  font-family: "Segoe UI", "PingFang SC", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(24, 119, 242, 0.14), transparent 30%),
    linear-gradient(180deg, #f6f8fb 0%, #ffffff 100%);
  color: #0f172a;
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
  font-family: "SFMono-Regular", "Consolas", monospace;
}

.app-shell {
  width: min(1120px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 32px 0 64px;
  display: grid;
  gap: 20px;
}

.hero-card,
.panel {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 60px rgba(15, 23, 42, 0.08);
  padding: 24px;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #475569;
}

h1,
h2,
p {
  margin: 0;
}

.lede {
  margin-top: 12px;
  color: #475569;
  line-height: 1.7;
}

.meta-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  margin-top: 20px;
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
  color: #64748b;
}

textarea,
input {
  width: 100%;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 18px;
  background: #fff;
  padding: 14px 16px;
  font-size: 14px;
  line-height: 1.6;
}

textarea {
  resize: vertical;
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
  background: #0f172a;
  color: white;
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  padding: 6px 10px;
  font-size: 12px;
}

.placeholder {
  color: #64748b;
}

.error-box,
.result-box {
  margin: 0;
  border-radius: 18px;
  padding: 16px;
  overflow: auto;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 180px;
}

.error-box {
  background: #450a0a;
  color: #fecaca;
}

@media (max-width: 720px) {
  .app-shell {
    width: min(100vw - 20px, 1120px);
    padding-top: 20px;
  }

  .hero-card,
  .panel {
    border-radius: 20px;
    padding: 18px;
  }

  .button-row {
    justify-content: stretch;
  }

  button {
    width: 100%;
  }
}
`
}
