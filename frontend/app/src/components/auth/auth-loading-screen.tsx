import { Loader2Icon } from "lucide-react";

import { APP_NAME } from "@/core/config/site";
import { useI18n } from "@/core/i18n/hooks";

export function AuthLoadingScreen() {
  const { t } = useI18n();

  return (
    // Centered minimal loading state — no decorative noise, just brand + status
    <div className="flex min-h-screen items-center justify-center bg-[#04060b] px-6 text-white">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="relative">
          {/* Subtle ring around spinner for depth without glow overload */}
          <div className="absolute inset-0 rounded-full border border-white/5" />
          <div className="rounded-full border border-white/10 bg-white/[0.03] p-4">
            <Loader2Icon className="size-5 animate-spin text-white/70" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium tracking-tight">{APP_NAME}</p>
          <p className="text-sm text-white/50">{t.auth.restoringSession}</p>
        </div>
      </div>
    </div>
  );
}
