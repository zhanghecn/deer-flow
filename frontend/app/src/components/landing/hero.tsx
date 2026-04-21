import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Hero({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-full flex-col items-center justify-center",
        className,
      )}
    >
      {/* Subtle dark gradient background instead of heavy canvas effects */}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900/40 via-[#04060b] to-[#04060b]" />

      {/* Very subtle dot pattern overlay for texture without noise */}
      <div
        className="absolute inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle, white 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />

      <div className="container-md relative z-10 mx-auto flex h-screen flex-col items-center justify-center px-6">
        {/* Product tagline pill */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/60">
          OpenAgents 2.0
        </div>

        {/* Main headline — single line, no word rotation animation */}
        <h1 className="text-center text-4xl font-bold tracking-tight md:text-6xl text-white">
          Research, build, and ship
          <br />
          <span className="text-white/80">with a single agent.</span>
        </h1>

        {/* Subtitle — tighter, clearer */}
        <p className="mt-6 max-w-2xl text-center text-base leading-relaxed text-white/50 md:text-lg">
          An open-source SuperAgent that researches, codes, and creates.
          With sandboxes, memories, tools, skills and subagents,
          it handles tasks that take minutes to hours.
        </p>

        {/* CTA group — primary/secondary distinction */}
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link to="/workspace">
            <Button
              size="lg"
              className="h-11 gap-2 bg-white text-black hover:bg-white/90 rounded-lg px-6"
            >
              <span className="text-sm font-medium">Enter Workspace</span>
              <ArrowRightIcon className="size-4" />
            </Button>
          </Link>
          <Link to="/workspace/chats/new">
            <Button
              variant="outline"
              size="lg"
              className="h-11 gap-2 rounded-lg px-6 border-white/15 bg-transparent text-white/80 hover:bg-white/5 hover:text-white"
            >
              <span className="text-sm font-medium">Start a chat</span>
              <ChevronRightIcon className="size-4" />
            </Button>
          </Link>
        </div>

        {/* Minimal trust signals */}
        <p className="mt-8 text-xs text-white/30">
          Fully open source · Self-hostable · No API key required
        </p>
      </div>
    </div>
  );
}
