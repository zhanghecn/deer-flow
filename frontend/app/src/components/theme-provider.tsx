import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useLocation } from "react-router-dom";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  const pathname = useLocation().pathname;
  return (
    <NextThemesProvider
      {...props}
      forcedTheme={pathname === "/" ? "dark" : undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
