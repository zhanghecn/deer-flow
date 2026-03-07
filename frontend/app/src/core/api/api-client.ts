"use client";

import { Client as LangGraphClient } from "@langchain/langgraph-sdk/client";

import { getAuthToken } from "@/core/auth/store";

import { getLangGraphBaseURL } from "../config";

let _singleton: LangGraphClient | null = null;
let _singletonToken: string | null = null;

export function getAPIClient(isMock?: boolean): LangGraphClient {
  const token = getAuthToken();

  // Recreate client if token changed (login/logout)
  if (_singleton && _singletonToken !== token) {
    _singleton = null;
  }

  if (!_singleton) {
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    _singleton = new LangGraphClient({
      apiUrl: getLangGraphBaseURL(isMock),
      defaultHeaders: headers,
    });
    _singletonToken = token;
  }

  return _singleton;
}
