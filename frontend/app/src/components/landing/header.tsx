import { GitHubLogoIcon, StarFilledIcon } from "@radix-ui/react-icons";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import {
  APP_NAME,
  GITHUB_REPO_API_URL,
  GITHUB_REPO_URL,
} from "@/core/config/site";

let githubStarCount: number | null = null;
let githubStarCountPromise: Promise<number | null> | null = null;

async function loadGitHubStarCount() {
  if (githubStarCount !== null) {
    return githubStarCount;
  }

  githubStarCountPromise ??= fetch(GITHUB_REPO_API_URL)
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        const data = (await response.json()) as {
          stargazers_count?: number;
        };
        const stars =
          typeof data.stargazers_count === "number"
            ? data.stargazers_count
            : null;
        githubStarCount = stars;
        return stars;
      })
      .catch(() => null)
      .finally(() => {
        githubStarCountPromise = null;
      });

  return githubStarCountPromise;
}

export function Header() {
  return (
    <header className="container-md fixed top-0 right-0 left-0 z-20 mx-auto flex h-16 items-center justify-between backdrop-blur-xs">
      <div className="flex items-center gap-2">
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <h1 className="font-serif text-xl">{APP_NAME}</h1>
        </a>
      </div>
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-0 z-0 h-full w-full rounded-full opacity-30 blur-2xl"
          style={{
            background: "linear-gradient(90deg, #ff80b5 0%, #9089fc 100%)",
            filter: "blur(16px)",
          }}
        />
        <Button
          variant="outline"
          size="sm"
          asChild
          className="group relative z-10"
        >
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitHubLogoIcon className="size-4" />
            Star on GitHub
            <GitHubStarCounter />
          </a>
        </Button>
      </div>
      <hr className="from-border/0 via-border/70 to-border/0 absolute top-16 right-0 left-0 z-10 m-0 h-px w-full border-none bg-linear-to-r" />
    </header>
  );
}

function GitHubStarCounter() {
  const [stars, setStars] = useState(10000);

  useEffect(() => {
    let active = true;

    void loadGitHubStarCount().then((nextStars) => {
      if (active && typeof nextStars === "number") {
        setStars(nextStars);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <StarFilledIcon className="size-4 transition-colors duration-300 group-hover:text-yellow-500" />
      <NumberTicker className="font-mono tabular-nums" value={stars} />
    </>
  );
}
