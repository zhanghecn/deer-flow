import { useCallback, useEffect, useSyncExternalStore } from "react";

import { restoreAuthSession } from "./api";
import {
  type AuthUser,
  clearAuth,
  getAuthSnapshot,
  subscribeAuth,
} from "./store";

export function useAuth() {
  const snapshot = useSyncExternalStore(
    subscribeAuth,
    getAuthSnapshot,
    () => ({
      token: null,
      user: null as AuthUser | null,
      ready: false,
    }),
  );

  useEffect(() => {
    if (!snapshot.ready) {
      void restoreAuthSession();
    }
  }, [snapshot.ready]);

  const logout = useCallback(() => {
    clearAuth();
  }, []);

  return {
    token: snapshot.token,
    user: snapshot.user,
    authenticated: snapshot.token !== null && snapshot.user !== null,
    ready: snapshot.ready,
    logout,
  };
}
