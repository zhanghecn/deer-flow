import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { login as apiLogin } from "@/lib/api";
import type { AuthUser } from "@/types";

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (account: string, password: string) => Promise<void>;
  logout: () => void;
}

const STORAGE_KEY = "admin_auth";

function loadFromStorage(): { token: string; user: AuthUser } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    isLoading: true,
  });

  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) {
      setState({ token: stored.token, user: stored.user, isLoading: false });
    } else {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, []);

  const login = useCallback(async (account: string, password: string) => {
    const res = await apiLogin(account, password);
    if (res.user.role !== "admin") {
      throw new Error("Admin access required");
    }
    const payload = { token: res.token, user: res.user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    setState({ token: res.token, user: res.user as AuthUser, isLoading: false });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({ token: null, user: null, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
