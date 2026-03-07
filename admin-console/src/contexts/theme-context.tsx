import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = "admin_theme";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem(STORAGE_KEY) as Theme) || "system";
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme) || "system";
    return stored === "system" ? getSystemTheme() : stored;
  });

  const applyTheme = useCallback((t: Theme) => {
    const actual = t === "system" ? getSystemTheme() : t;
    setResolved(actual);
    document.documentElement.classList.toggle("dark", actual === "dark");
  }, []);

  const setTheme = useCallback(
    (t: Theme) => {
      localStorage.setItem(STORAGE_KEY, t);
      setThemeState(t);
      applyTheme(t);
    },
    [applyTheme],
  );

  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
