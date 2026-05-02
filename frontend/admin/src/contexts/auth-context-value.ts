import { createContext } from "react";
import type { AuthUser } from "@/types";

export interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
}

export interface AuthContextValue extends AuthState {
  login: (account: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
