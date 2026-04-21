import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function Welcome({
  className,
  mode,
}: {
  className?: string;
  mode?: "pro" | "flash";
}) {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const isPro = useMemo(() => mode === "pro", [mode]);

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-center justify-center gap-2 px-6 py-6 text-center",
        className,
      )}
    >
      <div className="text-2xl font-semibold tracking-tight text-foreground">
        {searchParams.get("mode") === "skill" ? (
          t.welcome.createYourOwnSkill
        ) : (
          <span className="inline-flex items-center gap-2">
            <span>{isPro ? "🚀" : "👋"}</span>
            {/* Solid color text replaces animated aurora for calmer hierarchy */}
            <span
              className={cn(
                isPro
                  ? "text-amber-500 dark:text-amber-400"
                  : "text-foreground dark:text-foreground/90",
              )}
            >
              {t.welcome.greeting}
            </span>
          </span>
        )}
      </div>
      {searchParams.get("mode") === "skill" ? (
        <div className="text-muted-foreground max-w-md text-sm leading-relaxed">
          {t.welcome.createYourOwnSkillDescription.includes("\n") ? (
            <pre className="font-sans whitespace-pre-wrap">
              {t.welcome.createYourOwnSkillDescription}
            </pre>
          ) : (
            <p>{t.welcome.createYourOwnSkillDescription}</p>
          )}
        </div>
      ) : (
        <div className="text-muted-foreground max-w-lg text-sm leading-relaxed">
          {t.welcome.description.includes("\n") ? (
            <pre className="font-sans whitespace-pre-wrap">
              {t.welcome.description}
            </pre>
          ) : (
            <p>{t.welcome.description}</p>
          )}
        </div>
      )}
    </div>
  );
}
