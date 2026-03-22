import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { CaseStudySection } from "@/components/landing/sections/case-study-section";
import { CommunitySection } from "@/components/landing/sections/community-section";
import { SandboxSection } from "@/components/landing/sections/sandbox-section";
import { SkillsSection } from "@/components/landing/sections/skills-section";
import { WhatsNewSection } from "@/components/landing/sections/whats-new-section";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#04060b] text-white">
      <Header />
      <main className="relative overflow-x-hidden">
        <Hero />
        <div className="relative z-10 space-y-24 pb-24">
          <WhatsNewSection />
          <SkillsSection />
          <SandboxSection />
          <CaseStudySection />
          <CommunitySection />
        </div>
      </main>
    </div>
  );
}
