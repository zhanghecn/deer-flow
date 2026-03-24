import { Globe2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  APP_NAME,
  OFFICIAL_WEBSITE_URL,
} from "@/core/config/site";

export function Header() {
  return (
    <header className="container-md fixed top-0 right-0 left-0 z-20 mx-auto flex h-16 items-center justify-between backdrop-blur-xs">
      <div className="flex items-center gap-2">
        <a
          href={OFFICIAL_WEBSITE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <h1 className="font-serif text-xl">{APP_NAME}</h1>
        </a>
      </div>
      <WebsiteButton />
      <hr className="from-border/0 via-border/70 to-border/0 absolute top-16 right-0 left-0 z-10 m-0 h-px w-full border-none bg-linear-to-r" />
    </header>
  );
}

function WebsiteButton() {
  return (
    <Button variant="outline" size="sm" asChild>
      <a
        href={OFFICIAL_WEBSITE_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Globe2Icon className="size-4" />
        Visit Website
      </a>
    </Button>
  );
}
