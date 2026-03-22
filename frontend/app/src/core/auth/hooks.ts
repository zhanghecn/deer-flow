import { useCallback, useSyncExternalStore } from "react";

import {
  type AuthUser,
  clearAuth,
  getAuthToken,
  getAuthUser,
  isAuthenticated,
  subscribeAuth,
} from "./store";

export function useAuth() {
  const token = useSyncExternalStore(
    subscribeAuth,
    getAuthToken,
    () => null,
  );
  const user = useSyncExternalStore(
    subscribeAuth,
    getAuthUser,
    () => null as AuthUser | null,
  );
  const authenticated = useSyncExternalStore(
    subscribeAuth,
    isAuthenticated,
    () => false,
  );

  const logout = useCallback(() => {
    clearAuth();
  }, []);

  return { token, user, authenticated, logout };
}
