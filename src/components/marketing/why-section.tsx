import { Terminal } from '@/components/ui/terminal';
import { RobotMascot } from '@/components/marketing/robot-mascot';

export function WhySection() {
  return (
    <section id="why" className="dex-section w-full bg-[#0B0B0F]">
      <div className="mx-auto grid max-w-6xl gap-16 md:grid-cols-2 md:items-center">
        <div>
          <h2 className="dex-h2">
            You can&apos;t fix what you can&apos;t see.
          </h2>
          <p className="dex-lead mt-6">
            Search Console only shows pages with recent traffic. When a page goes quiet, it drops out of every
            report built on that data, so nobody fixes it.
          </p>
          <p className="dex-body mt-4 max-w-md">
            The tools that do spot a problem often change your site themselves. Live, while you&apos;re not looking.
          </p>
        </div>

        <Terminal
          username="dex"
          // Dex's real October 2026 scan of its own site, the same findings as the results section.
          commands={['dex scan dex-ai-plum.vercel.app', 'dex rescan dex-ai-plum.vercel.app']}
          outputs={{
            0: [
              'reading every page, even the quiet ones... ok',
              '6 problems google and ai search trip over:',
              '  x google shows an internal note as the description',
              '  x no sitemap, no robots.txt',
              '  x no main-page tag, no company or faq markup',
              'fixes drafted. 5 safety checks on each.',
              'waiting for your yes.',
            ],
            1: ['6 of 6 fixed. confirmed by a fresh scan.'],
          }}
          enableSound={false}
          className="max-w-none"
          headerAccessory={<RobotMascot />}
        />
      </div>
    </section>
  );
}
