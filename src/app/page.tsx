import { SiteNav } from '@/components/marketing/site-nav';
import { Hero } from '@/components/marketing/hero';
import { WhySection } from '@/components/marketing/why-section';
import { HowSection } from '@/components/marketing/how-section';
import { WhatSection } from '@/components/marketing/what-section';
import { StatusBoardSection } from '@/components/marketing/status-board-section';
import { RoadmapSection } from '@/components/marketing/roadmap-section';
import { TestimonialsSection } from '@/components/marketing/testimonials-section';
import { ResultsSection } from '@/components/marketing/results-section';
import { FaqSection } from '@/components/marketing/faq-section';
import { FinalCtaSection } from '@/components/marketing/final-cta-section';
import { SiteFooter } from '@/components/marketing/site-footer';
import { Reveal } from '@/components/marketing/reveal';
import { SmoothScroll } from '@/components/marketing/smooth-scroll';
import { FloatingDock } from '@/components/marketing/floating-dock';
import type { Metadata } from 'next';
import { homepageJsonLd } from '@/lib/site-seo';

export const metadata: Metadata = { alternates: { canonical: '/' } };

export default function HomePage() {
  return (
    <div className="dex-marketing dark min-h-screen bg-[#0B0B0F]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageJsonLd()) }} />
      <SmoothScroll />
      <SiteNav />
      <FloatingDock />
      <main>
        <Hero />
        <StatusBoardSection />
        <Reveal>
          <WhySection />
        </Reveal>
        <ResultsSection />
        <Reveal>
          <HowSection />
        </Reveal>
        <Reveal>
          <WhatSection />
        </Reveal>
        <Reveal><RoadmapSection /></Reveal>
        <TestimonialsSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}
