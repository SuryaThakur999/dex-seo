// Maps a scan's real stored log message (run-scan.ts / scan-worker.ts) to friendlier customer
// wording — DEX CONTINUATION MASTER DIRECTIVE Phase 3: "Friendly wording may summarize
// technical activity but cannot invent actions." Same exact-pattern-match discipline as
// scan-stages.ts's classifier: every pattern mirrors one real message shape, real captured
// values (counts, URLs) are carried through, and anything unmatched is returned unchanged
// rather than guessed at — a wording change in run-scan.ts simply stops getting a friendly
// rewrite instead of silently mislabeling.

type Formatter = (match: RegExpMatchArray) => string;

function plural(n: string, word: string, pluralWord = `${word}s`): string {
  return n === '1' ? word : pluralWord;
}

const FRIENDLY_PATTERNS: [RegExp, Formatter][] = [
  [/^Starting scan for .+\.\.\.$/, () => 'Website acquired.'],
  [/^Found (\d+) pages? to check\.$/, (m) => `${m[1]} ${plural(m[1], 'page')} discovered.`],
  [/^Checking (.+)\.\.\.$/, (m) => `Checking ${m[1]}...`],
  [/^SEO Specialist recorded (\d+) finding\(s\)\.$/, (m) => `Technical SEO checked — ${m[1]} ${plural(m[1], 'finding')}.`],
  [/^GEO Specialist recorded (\d+) finding\(s\)\.$/, (m) => `AI-discoverability checked — ${m[1]} ${plural(m[1], 'finding')}.`],
  [/^Brand Specialist recorded (\d+) finding\(s\)\.$/, (m) => `Brand and content checked — ${m[1]} ${plural(m[1], 'finding')}.`],
  [/^Found (\d+) page\(s\) worth fixing\.$/, (m) => `${m[1]} ${plural(m[1], 'opportunity', 'opportunities')} ready to draft.`],
  [/^Skipping .+ \(already has a pending draft\)\.$/, () => 'Already has a draft in progress — skipped.'],
  [/^Skipping .+ \(recently reviewed\)\.$/, () => 'Recently reviewed — skipped.'],
  [/^Skipping .+ \(content unchanged since last check\)\.$/, () => 'No changes since last check — skipped.'],
  [/^Drafting a fix for (.+)\.\.\.$/, (m) => `Drafting a fix for ${m[1]}...`],
  [/^ProofLayer: pass — .+$/, () => 'Draft passed ProofLayer.'],
  [/^ProofLayer: flag — .+$/, () => 'ProofLayer flagged this draft for review.'],
  [/^ProofLayer: block — .+$/, () => 'ProofLayer blocked this draft.'],
  [/^Couldn't process .+\.$/, () => "Couldn't process this page."],
  [
    /^Scan complete — (\d+) pages? checked, (\d+) drafts? created\.$/,
    (m) => `Scan complete — ${m[1]} ${plural(m[1], 'page')} checked, ${m[2]} ${plural(m[2], 'draft')} ready.`,
  ],
];

export function friendlyLogMessage(raw: string): string {
  for (const [pattern, format] of FRIENDLY_PATTERNS) {
    const match = raw.match(pattern);
    if (match) return format(match);
  }
  return raw;
}
