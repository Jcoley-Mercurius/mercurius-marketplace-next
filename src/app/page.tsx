import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { HowItWorksSteps } from "@/components/home/HowItWorksSteps";
import { ProblemSolutionSection } from "@/components/home/ProblemSolutionSection";
import { TrustPositioningSection } from "@/components/home/TrustPositioningSection";
import { TestimonialsSection } from "@/components/home/TestimonialsSection";
import { HeroSection } from "@/components/home/HeroSection";
import { PlanBuilderSection } from "@/components/home/PlanBuilderSection";
import { SpotlightProviders } from "@/components/home/SpotlightProviders";
import { FinalCTASection } from "@/components/home/FinalCTASection";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" tabIndex={-1} className="flex-1">
        <HeroSection />

        <HowItWorksSteps />

        <PlanBuilderSection />

        <ProblemSolutionSection />

        <TrustPositioningSection />

        <SpotlightProviders />

        <TestimonialsSection />

        <FinalCTASection />
      </main>

      <Footer />
    </div>
  );
}
