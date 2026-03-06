"use client";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar_url?: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
}

const AUTH_STORAGE_KEY = "openagents-auth";

function loadState(): AuthState {
  if (typeof window === "undefined") {
    return { token: null, user: null };
  }
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return { token: null, user: null };
    return JSON.parse(raw) as AuthState;
  } catch {
    return { token: null, user: null };
  }
}

function saveState(state: AuthState) {
  if (typeof window === "undefined") return;
  if (state.token) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

let _state = loadState();
const _listeners = new Set<() => void>();

function notify() {
  for (const fn of _listeners) fn();
}

export function getAuthToken(): string | null {
  return _state.token;
}

export function getAuthUser(): AuthUser | null {
  return _state.user;
}

export function isAuthenticated(): boolean {
  return _state.token !== null;
}

export function setAuth(token: string, user: AuthUser) {
  _state = { token, user };
  saveState(_state);
  notify();
}

export function clearAuth() {
  _state = { token: null, user: null };
  saveState(_state);
  notify();
}

export function subscribeAuth(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}
