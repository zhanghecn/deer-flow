"use client";

import { Client as LangGraphClient } from "@langchain/langgraph-sdk/client";

import { getAuthToken, getAuthUser } from "@/core/auth/store";

import { getLangGraphBaseURL } from "../config";

let _singleton: LangGraphClient | null = null;
let _singletonToken: string | null = null;
let _singletonUserId: string | null = null;

export function getAPIClient(isMock?: boolean): LangGraphClient {
  const token = getAuthToken();
  const userId = getAuthUser()?.id ?? null;

  // Recreate client if auth identity changed so LangGraph headers stay aligned.
  if (_singleton && (_singletonToken !== token || _singletonUserId !== userId)) {
    _singleton = null;
  }

  if (!_singleton) {
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (userId) {
      headers["x-user-id"] = userId;
    }

    _singleton = new LangGraphClient({
      apiUrl: getLangGraphBaseURL(isMock),
      defaultHeaders: headers,
    });
    _singletonToken = token;
    _singletonUserId = userId;
  }

  return _singleton;
}
