import fs from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import path from "path";

import type { Plugin, ViteDevServer } from "vite";

function parseJson(str: string) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
  });
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function mockApiPlugin(): Plugin {
  return {
    name: "mock-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          const url = req.url ?? "";

          // POST /mock/api/threads (create thread)
          if (url === "/mock/api/threads" && req.method === "POST") {
            const body = parseJson(await readBody(req)) as { thread_id?: string };
            const bodyThreadId = body.thread_id?.trim();
            const headerThreadId = req.headers["x-thread-id"]?.toString().trim();
            const threadId =
              bodyThreadId && bodyThreadId.length > 0
                ? bodyThreadId
                : headerThreadId && headerThreadId.length > 0
                  ? headerThreadId
                  : "";
            if (!threadId) {
              return sendJson(res, { error: "thread_id is required" }, 400);
            }
            return sendJson(res, { thread_id: threadId });
          }

          // POST /mock/api/threads/search
          if (url === "/mock/api/threads/search" && req.method === "POST") {
            const threadsDir = path.resolve(process.cwd(), "public/demo/threads");
            if (!fs.existsSync(threadsDir)) {
              return sendJson(res, []);
            }
            const entries = fs.readdirSync(threadsDir, { withFileTypes: true });
            const threadData = entries
              .filter((e) => e.isDirectory() && !e.name.startsWith("."))
              .map((e) => {
                const threadFile = path.resolve(
                  threadsDir,
                  e.name,
                  "thread.json",
                );
                if (!fs.existsSync(threadFile)) return null;
                const data = JSON.parse(fs.readFileSync(threadFile, "utf8"));
                return { thread_id: e.name, values: data.values };
              })
              .filter(Boolean);
            return sendJson(res, threadData);
          }

          // Match /mock/api/threads/:thread_id/...
          const threadMatch =
            /^\/mock\/api\/threads\/([^/]+)\/(state|history|artifacts)(\/.*)?$/.exec(
              url,
            );
          if (threadMatch) {
            const threadId = threadMatch[1]!;
            const action = threadMatch[2]!;
            const subPath = threadMatch[3] ?? "";

            const threadFile = path.resolve(
              process.cwd(),
              `public/demo/threads/${threadId}/thread.json`,
            );

            if (action === "state") {
              if (!fs.existsSync(threadFile)) {
                return sendJson(res, { error: "Thread not found" }, 404);
              }
              const data = JSON.parse(fs.readFileSync(threadFile, "utf8"));
              return sendJson(res, data);
            }

            if (action === "history" && req.method === "POST") {
              if (!fs.existsSync(threadFile)) {
                return sendJson(res, { error: "Thread not found" }, 404);
              }
              const data = JSON.parse(fs.readFileSync(threadFile, "utf8"));
              return sendJson(res, Array.isArray(data.history) ? data : [data]);
            }

            if (action === "artifacts") {
              let artifactPath = subPath.replace(/^\//, "");
              if (artifactPath.startsWith("mnt/")) {
                artifactPath = path.resolve(
                  process.cwd(),
                  artifactPath.replace(
                    "mnt/",
                    `public/demo/threads/${threadId}/`,
                  ),
                );
                if (fs.existsSync(artifactPath)) {
                  const urlObj = new URL(url, "http://localhost");
                  if (urlObj.searchParams.get("download") === "true") {
                    res.writeHead(200, {
                      "Content-Disposition": `attachment; filename="${path.basename(artifactPath)}"`,
                    });
                    return res.end(fs.readFileSync(artifactPath));
                  }
                  if (artifactPath.endsWith(".mp4")) {
                    res.writeHead(200, { "Content-Type": "video/mp4" });
                    return res.end(fs.readFileSync(artifactPath));
                  }
                  res.writeHead(200);
                  return res.end(fs.readFileSync(artifactPath));
                }
              }
              res.writeHead(404);
              return res.end("File not found");
            }
          }

          // GET /mock/api/models
          if (url === "/mock/api/models" && req.method === "GET") {
            return sendJson(res, {
              models: [
                { id: "doubao-seed-1.8", name: "doubao-seed-1.8", display_name: "Doubao Seed 1.8", supports_thinking: true },
                { id: "deepseek-v3.2", name: "deepseek-v3.2", display_name: "DeepSeek v3.2", supports_thinking: true },
                { id: "gpt-5", name: "gpt-5", display_name: "GPT-5", supports_thinking: true },
                { id: "gemini-3-pro", name: "gemini-3-pro", display_name: "Gemini 3 Pro", supports_thinking: true },
              ],
            });
          }

          // GET /mock/api/skills
          if (url === "/mock/api/skills" && req.method === "GET") {
            return sendJson(res, {
              skills: [
                { name: "deep-research", description: "Use this skill BEFORE any content generation task (PPT, design, articles, images, videos, reports). Provides a systematic methodology for conducting thorough, multi-angle web research to gather comprehensive information.", license: null, category: "public", enabled: true },
                { name: "frontend-design", description: "Create distinctive, production-grade frontend interfaces with high design quality.", license: "Complete terms in LICENSE.txt", category: "public", enabled: true },
                { name: "github-deep-research", description: "Conduct multi-round deep research on any GitHub Repo.", license: null, category: "public", enabled: true },
                { name: "image-generation", description: "Use this skill when the user requests to generate, create, imagine, or visualize images.", license: null, category: "public", enabled: true },
                { name: "podcast-generation", description: "Use this skill when the user requests to generate, create, or produce podcasts from text content.", license: null, category: "public", enabled: true },
                { name: "ppt-generation", description: "Use this skill when the user requests to generate, create, or make presentations (PPT/PPTX).", license: null, category: "public", enabled: true },
                { name: "skill-creator", description: "Guide for creating effective skills.", license: "Complete terms in LICENSE.txt", category: "public", enabled: true },
                { name: "vercel-deploy", description: "Deploy applications and websites to Vercel.", license: null, category: "public", enabled: true },
                { name: "video-generation", description: "Use this skill when the user requests to generate, create, or imagine videos.", license: null, category: "public", enabled: true },
                { name: "web-design-guidelines", description: "Review UI code for Web Interface Guidelines compliance.", license: null, category: "public", enabled: true },
              ],
            });
          }

          // GET /mock/api/mcp/config
          if (url === "/mock/api/mcp/config" && req.method === "GET") {
            return sendJson(res, {
              mcp_servers: {
                "mcp-github-trending": {
                  enabled: true, type: "stdio", command: "uvx",
                  args: ["mcp-github-trending"], env: {}, url: null, headers: {},
                  description: "A MCP server that provides access to GitHub trending repositories and developers data",
                },
                "context-7": {
                  enabled: true,
                  description: "Get the latest documentation and code into Cursor, Claude, or other LLMs",
                },
                "feishu-importer": {
                  enabled: true,
                  description: "Import Feishu documents",
                },
              },
            });
          }

          // Not a mock route — pass through
          next();
        })();
      });
    },
  };
}
