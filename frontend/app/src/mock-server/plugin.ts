import type { IncomingMessage, ServerResponse } from "http";

import type { Plugin, ViteDevServer } from "vite";

type MockThread = {
  values: {
    title: string;
    messages: Array<Record<string, unknown>>;
    thread_data: Record<string, unknown>;
    uploaded_files: unknown[];
    artifacts: string[];
  };
  next: unknown[];
  tasks: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
  checkpoint: Record<string, unknown>;
  parent_checkpoint: null;
  interrupts: unknown[];
  checkpoint_id: string;
  parent_checkpoint_id: null;
  history?: unknown[];
};

// Keep the minimal fixtures in code so mock-mode e2e coverage does not depend
// on committed demo snapshots under public assets.
const MOCK_THREADS: Record<string, MockThread> = {
  "test-cancel": {
    values: {
      title: "Follow-up after stop",
      messages: [
        {
          type: "human",
          id: "human-cancel-1",
          content: [{ type: "text", text: "Initial draft request" }],
          additional_kwargs: {},
        },
        {
          type: "ai",
          id: "ai-cancel-1",
          content: [{ type: "text", text: "Here is the first draft." }],
          additional_kwargs: {},
          response_metadata: {},
        },
        {
          type: "human",
          id: "human-cancel-2",
          content: [{ type: "text", text: "Please revise the second paragraph." }],
          additional_kwargs: {},
        },
        {
          type: "ai",
          id: "ai-cancel-2",
          content: [{ type: "text", text: "Updated the second paragraph." }],
          additional_kwargs: {},
          response_metadata: {},
        },
      ],
      thread_data: {},
      uploaded_files: [],
      artifacts: [],
    },
    next: [],
    tasks: [],
    metadata: {},
    created_at: "2026-03-18T00:00:00Z",
    checkpoint: {},
    parent_checkpoint: null,
    interrupts: [],
    checkpoint_id: "checkpoint-cancel",
    parent_checkpoint_id: null,
  },
  "test-error": {
    values: {
      title: "Error thread",
      messages: [],
      thread_data: {},
      uploaded_files: [],
      artifacts: [],
    },
    next: [],
    tasks: [],
    metadata: {},
    created_at: "2026-03-18T00:00:00Z",
    checkpoint: {},
    parent_checkpoint: null,
    interrupts: [],
    checkpoint_id: "checkpoint-error",
    parent_checkpoint_id: null,
  },
  "test-subagents": {
    values: {
      title: "Completed subtasks",
      messages: [
        {
          type: "human",
          id: "human-subtasks-1",
          content: [{ type: "text", text: "Break this work into subtasks." }],
          additional_kwargs: {},
        },
        {
          type: "ai",
          id: "ai-subtasks-1",
          content: "",
          additional_kwargs: {},
          response_metadata: {},
          tool_calls: [
            {
              name: "task",
              id: "task-sub-1",
              args: {
                description: "Review source material",
                prompt: "Read the source material and summarize key points.",
                subagent_type: "research",
              },
            },
            {
              name: "task",
              id: "task-sub-2",
              args: {
                description: "Draft final response",
                prompt: "Prepare the final answer from the gathered notes.",
                subagent_type: "writer",
              },
            },
          ],
        },
        {
          type: "tool",
          id: "tool-sub-1",
          name: "task",
          tool_call_id: "task-sub-1",
          content: "Task Succeeded. Result: Reviewed the source material.",
        },
        {
          type: "tool",
          id: "tool-sub-2",
          name: "task",
          tool_call_id: "task-sub-2",
          content: "Task Succeeded. Result: Drafted the final answer.",
        },
      ],
      thread_data: {},
      uploaded_files: [],
      artifacts: [],
    },
    next: [],
    tasks: [],
    metadata: {},
    created_at: "2026-03-18T00:00:00Z",
    checkpoint: {},
    parent_checkpoint: null,
    interrupts: [],
    checkpoint_id: "checkpoint-subtasks",
    parent_checkpoint_id: null,
  },
};

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
            const body = parseJson(await readBody(req)) as { query?: string };
            const query = body.query?.trim().toLowerCase() ?? "";
            const items = Object.entries(MOCK_THREADS)
              .map(([threadId, fixture]) => ({
                thread_id: threadId,
                updated_at: fixture.created_at ?? new Date().toISOString(),
                values:
                  typeof fixture.values.title === "string" &&
                  fixture.values.title.trim().length > 0
                    ? { title: fixture.values.title.trim() }
                    : {},
              }))
              .filter((item) => {
                if (!query) {
                  return true;
                }
                const title =
                  typeof item.values?.title === "string" ? item.values.title : "";
                return title.toLowerCase().includes(query);
              });
            res.setHeader("x-pagination-total", String(items.length));
            return sendJson(res, items);
          }

          // Match /mock/api/threads/:thread_id/...
          const threadMatch =
            /^\/mock\/api\/threads\/([^/]+)\/(state|history|artifacts)(\/.*)?$/.exec(
              url,
            );
          if (threadMatch) {
            const threadId = threadMatch[1]!;
            const action = threadMatch[2]!;
            const fixture = MOCK_THREADS[threadId] ?? null;

            if (action === "state") {
              if (fixture) {
                return sendJson(res, fixture);
              }
              return sendJson(res, { error: "Thread not found" }, 404);
            }

            if (action === "history" && req.method === "POST") {
              if (fixture) {
                return sendJson(
                  res,
                  Array.isArray(fixture.history) ? fixture : [fixture],
                );
              }
              return sendJson(res, { error: "Thread not found" }, 404);
            }

            if (action === "artifacts") {
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
