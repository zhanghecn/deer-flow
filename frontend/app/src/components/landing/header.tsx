import { ArrowRightIcon, Globe2Icon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  APP_NAME,
  OFFICIAL_WEBSITE_URL,
} from "@/core/config/site";

export function Header() {
  return (
    <header className="container-md fixed top-0 right-0 left-0 z-20 mx-auto flex h-14 items-center justify-between px-6">
      {/* Subtle backdrop without heavy blur */}
      <div className="absolute inset-0 bg-[#04060b]/80 backdrop-blur-sm" />

      <div className="relative flex items-center gap-2">
        <Link to="/" className="font-serif text-lg tracking-tight text-white/90 hover:text-white transition-colors">
          {APP_NAME}
        </Link>
      </div>

      <div className="relative flex items-center gap-3">
        <a
          href={OFFICIAL_WEBSITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/70 transition-colors"
        >
          <Globe2Icon className="size-3.5" />
          Website
        </a>
        <Link to="/workspace">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white text-xs"
          >
            Get Started
            <ArrowRightIcon className="size-3.5" />
          </Button>
        </Link>
      </div>
    </header>
  );
}
