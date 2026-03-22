import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

export function loadChromium(repoRoot) {
  const requireFromFrontend = createRequire(
    path.join(repoRoot, "frontend/app/package.json"),
  );
  return requireFromFrontend("@playwright/test").chromium;
}

export function parseThreadIdFromURL(urlString) {
  const url = new URL(urlString);
  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts.at(-1) ?? "";
  return last === "new" ? null : last;
}

export function extractThreadIdFromRunURL(urlString) {
  const matched = /\/threads\/([^/]+)\/runs(?:\/|$)/.exec(urlString);
  return matched?.[1] ?? null;
}

export function isRunStreamRequest(request) {
  const url = request.url();
  return (
    request.method() === "POST" &&
    url.includes("/api/langgraph/") &&
    url.includes("/runs") &&
    !url.includes("/history") &&
    !url.includes("/state")
  );
}

export function extractTextParts(content) {
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

export function latestAssistantText(messages = []) {
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

export async function waitForCondition(
  description,
  predicate,
  timeoutMs,
  intervalMs = 1000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await predicate();
    if (result) {
      return result;
    }
    await delay(intervalMs);
  }

  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms`);
}

export async function login(
  page,
  { baseUrl, account, password, timeoutMs = 60000 },
) {
  await page.goto(`${baseUrl}/login`, {
    waitUntil: "commit",
    timeout: timeoutMs,
  });
  await page.locator("#login-account").waitFor({
    state: "visible",
    timeout: timeoutMs,
  });
  await page.waitForFunction(
    () => {
      const accountInput = document.querySelector("#login-account");
      const passwordInput = document.querySelector("#login-password");

      return Boolean(
        accountInput &&
          passwordInput &&
          !accountInput.hasAttribute("disabled") &&
          !passwordInput.hasAttribute("disabled"),
      );
    },
    undefined,
    { timeout: timeoutMs },
  );
  await page.locator("#login-account").fill(account);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: /sign in|登录/i }).click();

  await waitForCondition(
    "login completion",
    async () => {
      if (/\/workspace(\/|$)/.test(page.url())) {
        return true;
      }

      try {
        return await page.evaluate(() =>
          Boolean(window.localStorage.getItem("openagents-auth")),
        );
      } catch {
        return false;
      }
    },
    timeoutMs,
    500,
  );

  if (!/\/workspace(\/|$)/.test(page.url())) {
    await page.goto(`${baseUrl}/workspace`, {
      waitUntil: "commit",
      timeout: timeoutMs,
    });
  }
}

export async function readAuthState(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("openagents-auth");
    return raw ? JSON.parse(raw) : null;
  });
}

export function buildHeaders(auth, threadId) {
  const headers = {
    Authorization: `Bearer ${auth.token}`,
  };
  if (auth.user?.id) {
    headers["x-user-id"] = auth.user.id;
  }
  if (threadId) {
    headers["x-thread-id"] = threadId;
  }
  return headers;
}

export async function fetchRaw(
  auth,
  targetURL,
  { method = "GET", body, threadId } = {},
) {
  const headers = buildHeaders(auth, threadId);
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(targetURL, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function fetchJSON(
  auth,
  targetURL,
  { method = "GET", body, threadId } = {},
) {
  const response = await fetchRaw(auth, targetURL, { method, body, threadId });
  const text = await response.text();
  let payload = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // Keep raw text for debugging.
  }

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for ${targetURL}: ${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }`,
    );
  }

  return payload;
}

export async function getThreadState(auth, baseUrl, threadId) {
  return fetchJSON(
    auth,
    `${baseUrl}/api/langgraph/threads/${threadId}/state?subgraphs=true`,
    { threadId },
  );
}

export async function sendMessage(page, prompt) {
  const textarea = page.locator("textarea[name='message']").last();
  await textarea.click();
  await textarea.fill(prompt);
  await page.getByRole("button", { name: "Submit" }).last().click();
}

export async function capture(page, screenshotRoot, name) {
  const file = path.join(
    screenshotRoot,
    `${String(Date.now())}-${name.replace(/[^a-z0-9_-]+/gi, "-")}.png`,
  );
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

export function sanitizeProbeToken(value, fallback = "probe") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}
