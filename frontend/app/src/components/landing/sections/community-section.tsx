import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { Globe2Icon } from "lucide-react";

import { AuroraText } from "@/components/ui/aurora-text";
import { Button } from "@/components/ui/button";
import {
  GITHUB_REPO_URL,
  OFFICIAL_WEBSITE_URL,
  PUBLIC_GITHUB_REPO_AVAILABLE,
} from "@/core/config/site";

import { Section } from "../section";

export function CommunitySection() {
  return (
    <Section
      title={
        <AuroraText colors={["#60A5FA", "#A5FA60", "#A560FA"]}>
          Join the Community
        </AuroraText>
      }
      subtitle="Contribute brilliant ideas to shape the future of OpenAgents. Collaborate, innovate, and make impacts."
    >
      <div className="flex justify-center">
        <Button className="text-xl" size="lg" asChild>
          <a
            href={
              PUBLIC_GITHUB_REPO_AVAILABLE ? GITHUB_REPO_URL : OFFICIAL_WEBSITE_URL
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            {PUBLIC_GITHUB_REPO_AVAILABLE ? <GitHubLogoIcon /> : <Globe2Icon />}
            {PUBLIC_GITHUB_REPO_AVAILABLE ? "Contribute Now" : "Visit Website"}
          </a>
        </Button>
      </div>
    </Section>
  );
}
