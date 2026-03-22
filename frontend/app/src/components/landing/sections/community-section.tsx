import { GitHubLogoIcon } from "@radix-ui/react-icons";

import { AuroraText } from "@/components/ui/aurora-text";
import { Button } from "@/components/ui/button";
import { GITHUB_REPO_URL } from "@/core/config/site";

import { Section } from "../section";

export function CommunitySection() {
  return (
    <Section
      title={
        <AuroraText colors={["#60A5FA", "#A5FA60", "#A560FA"]}>
          Join the Community
        </AuroraText>
      }
      subtitle="Contribute brilliant ideas to shape the future of DeerFlow. Collaborate, innovate, and make impacts."
    >
      <div className="flex justify-center">
        <Button className="text-xl" size="lg" asChild>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
            <GitHubLogoIcon />
            Contribute Now
          </a>
        </Button>
      </div>
    </Section>
  );
}
