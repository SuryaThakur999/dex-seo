'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface BrandPreferences {
  clientProfileId: string;
  brandVoice: string | null;
  audience: string | null;
  approvedClaims: string[];
  restrictedWording: string[];
  markets: string[];
  languages: string[];
}

// Brief section 9: preferences must be inspectable and reversible. These fields already gate
// every content generation (Content Studio prompts, ProofLayer's restricted-wording check) —
// this is the first place a real customer can see or change them. All stated preferences, not
// inferred ones — no inference system exists yet, so nothing here pretends otherwise.
export function BrandPreferencesForm({ initial }: { initial: BrandPreferences }) {
  const [brandVoice, setBrandVoice] = useState(initial.brandVoice ?? '');
  const [audience, setAudience] = useState(initial.audience ?? '');
  const [approvedClaims, setApprovedClaims] = useState(initial.approvedClaims.join('\n'));
  const [restrictedWording, setRestrictedWording] = useState(initial.restrictedWording.join('\n'));
  const [markets, setMarkets] = useState(initial.markets.join('\n'));
  const [languages, setLanguages] = useState(initial.languages.join('\n'));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await fetch(`/api/client-profile/${initial.clientProfileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandVoice: brandVoice.trim() || null,
          audience: audience.trim() || null,
          approvedClaims: approvedClaims.split('\n'),
          restrictedWording: restrictedWording.split('\n'),
          markets: markets.split('\n'),
          languages: languages.split('\n'),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? 'Could not save these preferences. Try again.');
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="brand-voice" className="text-sm font-medium text-foreground">
          Brand voice
        </label>
        <Textarea
          id="brand-voice"
          value={brandVoice}
          onChange={(e) => setBrandVoice(e.target.value)}
          placeholder="e.g. Warm, direct, no corporate jargon"
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="audience" className="text-sm font-medium text-foreground">
          Audience
        </label>
        <Textarea
          id="audience"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="e.g. Small-business owners in the EU"
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="approved-claims" className="text-sm font-medium text-foreground">
          Approved claims
        </label>
        <p className="text-xs text-muted-foreground">
          One per line. Only these facts may be stated as certain in generated drafts — everything else gets flagged for
          review.
        </p>
        <Textarea
          id="approved-claims"
          value={approvedClaims}
          onChange={(e) => setApprovedClaims(e.target.value)}
          placeholder="Trusted by 500+ small businesses&#10;Founded in 2023"
          rows={4}
          className="font-mono text-xs"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="restricted-wording" className="text-sm font-medium text-foreground">
          Restricted wording
        </label>
        <p className="text-xs text-muted-foreground">One per line. Any draft containing these terms gets blocked.</p>
        <Textarea
          id="restricted-wording"
          value={restrictedWording}
          onChange={(e) => setRestrictedWording(e.target.value)}
          placeholder="guaranteed&#10;risk-free"
          rows={3}
          className="font-mono text-xs"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="markets" className="text-sm font-medium text-foreground">
          Markets
        </label>
        <p className="text-xs text-muted-foreground">One per line, e.g. Germany, United States.</p>
        <Textarea id="markets" value={markets} onChange={(e) => setMarkets(e.target.value)} placeholder="Germany&#10;United States" rows={2} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="languages" className="text-sm font-medium text-foreground">
          Languages
        </label>
        <p className="text-xs text-muted-foreground">One per line, e.g. German, English.</p>
        <Textarea id="languages" value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="German&#10;English" rows={2} />
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="accent" onClick={handleSave} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save preferences'}
        </Button>
        {saved && !error && <span className="text-xs text-[var(--dex-app-success)]">Saved.</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}
