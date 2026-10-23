import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, PENDING_WEBSITE_URL } from '@/lib/customer';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AutoExecuteToggle } from '@/components/auto-execute-toggle';
import { AddWebsiteForm } from '@/components/settings/add-website-form';
import { SplitCompanyButton } from '@/components/settings/split-company-button';
import { PendingUrlCopy } from '@/components/settings/pending-url-copy';
import { BrandPreferencesForm } from '@/components/settings/brand-preferences-form';
import { GamePreferenceForm } from '@/components/settings/game-preference-form';
import { LearningSection } from '@/components/settings/learning-section';
import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { computeGscConnectionState } from '@/lib/gsc-connection-state';
import { getMarketingMemory } from '@/lib/marketing-memory';
import { MarketingMemoryPanel } from '@/components/settings/marketing-memory-panel';
import { listProfileSuggestions } from '@/lib/profile-suggestions';
import { ProfileSuggestionsPanel, type ProfileSuggestionItem } from '@/components/settings/profile-suggestions-panel';
import { CompetitorListPanel, type CompetitorEntityItem } from '@/components/settings/competitor-list-panel';
import { SocialProfilesPanel, type SocialProfileItem } from '@/components/settings/social-profiles-panel';
import { SiteSwitcher } from '@/components/app-shell/site-switcher';
import { selectableWebsites } from '@/lib/website-selection';
import { signupSitePrefill } from '@/lib/signup-site';

const SETTINGS_SECTIONS = [
  { id: 'websites', label: 'Websites' },
  { id: 'memory', label: 'Marketing Memory' },
  { id: 'channels', label: 'Your channels' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'scan', label: 'Scan' },
  { id: 'appearance', label: 'Appearance' },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { gsc?: string; websiteId?: string; site?: string | string[] };
}) {
  const { userId } = auth();
  if (!userId) return null;

  const gscMessage =
    searchParams.gsc === 'declined'
      ? "You declined the Google permission request, so nothing was connected. Click Connect Search Console again if you'd like to try."
      : searchParams.gsc === 'error'
        ? 'Google returned an error connecting Search Console. Try again, or contact support if it keeps happening.'
        : null;

  let resolved;
  try {
    resolved = await resolveWebsiteForRequest(userId, searchParams.websiteId);
  } catch {
    // A stale or foreign websiteId falls back to the default website instead of failing the page.
    resolved = await resolveWebsiteForRequest(userId);
  }
  const { customer, websites } = resolved;
  const prefill = signupSitePrefill(resolved.website, websites, searchParams.site, searchParams.websiteId);
  const { selected } = prefill;
  // `websites` now spans every company this customer runs (brand-voice-isolation fix,
  // 2026-10-16), so each item needs its OWN company name, not whichever one is selected.
  const companyNameByProfileId = new Map(
    (await db.clientProfile.findMany({
      where: { id: { in: [...new Set(websites.map((w) => w.clientProfileId))] } },
      select: { id: true, name: true },
    })).map((p) => [p.id, p.name])
  );
  const pickable = selectableWebsites(websites).map((w) => ({ id: w.id, url: w.url, profileName: companyNameByProfileId.get(w.clientProfileId) }));
  // The per-site GSC/AutoExecute list below is scoped to the SELECTED company only --
  // `websites` itself now spans every company this customer runs (brand-voice-isolation
  // fix, 2026-10-16), which is correct for the cross-company switcher above but would
  // otherwise mix every company's sites into this one company's "Websites" card.
  const companyWebsites = websites.filter((w) => w.clientProfileId === selected.clientProfileId);
  const clientProfile = websites[0]
    ? await db.clientProfile.findUnique({
        where: { id: selected.clientProfileId },
        select: {
          id: true,
          name: true,
          brandVoice: true,
          audience: true,
          approvedClaims: true,
          restrictedWording: true,
          markets: true,
          languages: true,
          socialProfiles: true,
        },
      })
    : null;

  const memory = clientProfile ? await getMarketingMemory(clientProfile.id) : null;

  const profileSuggestions: ProfileSuggestionItem[] = clientProfile
    ? (await listProfileSuggestions({ customerId: customer.id, clientProfileId: clientProfile.id, websiteId: selected.id }))
        .map((s) => ({ id: s.id, field: s.field as ProfileSuggestionItem['field'], valueJson: s.valueJson as string | string[], sourceUrl: s.sourceUrl, sourceExcerpt: s.sourceExcerpt }))
    : [];

  const competitors: CompetitorEntityItem[] = clientProfile
    ? (await db.competitorEntity.findMany({
        where: { clientProfileId: clientProfile.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      })).map((c) => ({
        id: c.id, name: c.name, canonicalDomain: c.canonicalDomain,
        classification: c.classification as CompetitorEntityItem['classification'],
        classificationReason: c.classificationReason, userConfirmed: c.userConfirmed,
      }))
    : [];

  const candidates = clientProfile
    ? await db.preferenceCandidate.findMany({
        where: { clientProfileId: clientProfile.id, websiteId: selected.id },
        select: { id: true, originalProposedPhrase: true, customerEditedPhrase: true, status: true, generatedAt: true, website: { select: { url: true } }, evaluation: { select: { status: true, evaluatedPhrase: true } } },
        orderBy: { generatedAt: 'desc' },
        take: 20,
      })
    : [];

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground tracking-tight">Account settings</h1>

      {pickable.length > 0 && (
        <div className="sticky top-0 z-10 -mx-6 mt-4 flex flex-wrap items-center gap-3 border-b border-border bg-background/90 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <span className="text-sm text-muted-foreground">Website</span>
          <SiteSwitcher
            websites={pickable}
            currentWebsiteId={selected.id}
            profileName={clientProfile?.name}
            hrefPattern="/settings?websiteId={id}"
          />
          <span className="text-xs text-muted-foreground">
            Learning shows this site. Brand and Marketing Memory apply to every site of {clientProfile?.name ?? 'this company'}.
          </span>
        </div>
      )}

      <nav aria-label="Settings sections" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {SETTINGS_SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="inline-flex min-h-11 items-center text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
          >
            {section.label}
          </a>
        ))}
      </nav>

      {gscMessage && (
        <p className="mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {gscMessage}
        </p>
      )}

      <Card id="websites" className="mt-6 scroll-mt-24">
        <CardHeader>
          <CardTitle>Websites</CardTitle>
          <CardDescription>
            Up to {companyWebsites.length < 3 ? 3 : companyWebsites.length} sites per client profile. Each one connects to its own
            Google Search Console property.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {companyWebsites.map((site) => {
            const state = computeGscConnectionState(site);
            const notConnected = state === 'not_connected';
            const reconnectRequired = state === 'reconnect_required';
            const propertyPending = state === 'property_pending';
            // The sentinel's own normalized host must never be suggested as the
            // real URL — a customer who clicks "Confirm URL" without editing a
            // prefilled sentinel would silently re-write it, leaving the row
            // stuck forever with no visible error (see confirm-url route).
            const hostIsSentinel = site.normalizedHost === new URL(PENDING_WEBSITE_URL).hostname;

            return (
              <div key={site.id} className="flex flex-col gap-3 rounded-md border border-border p-4">
                {site.url === PENDING_WEBSITE_URL ? (
                  <div className="flex flex-col gap-2 rounded-md border border-[var(--dex-app-warning,#b45309)] p-3">
                    <PendingUrlCopy normalizedHost={site.normalizedHost} hostIsSentinel={hostIsSentinel} />
                    <form
                      action={`/api/websites/${site.id}/confirm-url`}
                      method="post"
                      className="flex flex-wrap items-center gap-3"
                    >
                      <input
                        name="url"
                        type="url"
                        required
                        defaultValue={
                          prefill.pendingId === site.id
                            ? prefill.initialUrl
                            : hostIsSentinel
                              ? undefined
                              : `https://${site.normalizedHost}`
                        }
                        placeholder="https://yoursite.com"
                        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                      />
                      <Button type="submit" size="sm" variant="accent">
                        Confirm URL
                      </Button>
                    </form>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-4">
                      {/* A site still on the pending sentinel has no real URL to show yet —
                          its normalized host is the one the user typed when adding it. */}
                      <span className="truncate font-mono text-sm font-medium text-foreground">
                        {site.url === PENDING_WEBSITE_URL ? site.normalizedHost : site.url}
                      </span>
                      {notConnected && (
                        <Button asChild size="sm" variant="outline">
                          <a href={`/api/gsc/connect?websiteId=${site.id}`}>Connect Search Console</a>
                        </Button>
                      )}
                      {reconnectRequired && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--dex-app-warning,#b45309)]">Reconnect needed</span>
                          <Button asChild size="sm" variant="outline">
                            <a href={`/api/gsc/connect?websiteId=${site.id}`}>Reconnect Search Console</a>
                          </Button>
                        </div>
                      )}
                      {propertyPending && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--dex-app-success)]">Google account linked — select a property</span>
                          <a href={`/api/gsc/connect?websiteId=${site.id}`} className="text-xs text-muted-foreground underline">
                            Wrong account? Reconnect
                          </a>
                        </div>
                      )}
                      {!notConnected && !reconnectRequired && !propertyPending && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--dex-app-success)]">Search Console connected</span>
                          <a href={`/api/gsc/connect?websiteId=${site.id}`} className="text-xs text-muted-foreground underline">
                            Reconnect
                          </a>
                        </div>
                      )}
                    </div>

                    {reconnectRequired && (
                      <p className="text-xs text-muted-foreground">
                        Search Console isn&apos;t working for this site right now. Reconnecting may fix it — your data
                        and other settings for this site are unaffected either way.
                      </p>
                    )}

                    {propertyPending && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Optional — your scans already run without this. Selecting a verified property adds real
                          Search Console numbers (impressions, clicks) on top of the crawl data.
                        </p>
                        <form action="/api/gsc/select-site" method="post" className="flex flex-wrap items-center gap-3">
                          <input type="hidden" name="websiteId" value={site.id} />
                          <label htmlFor={`siteUrl-${site.id}`} className="text-sm text-muted-foreground">
                            Choose a verified property:
                          </label>
                          <input
                            id={`siteUrl-${site.id}`}
                            name="siteUrl"
                            type="url"
                            required
                            placeholder="https://your-verified-property.com"
                            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                          />
                          <Button type="submit" size="sm" variant="accent">
                            Save
                          </Button>
                        </form>
                      </>
                    )}
                  </>
                )}

                <AutoExecuteToggle initialEnabled={site.autoExecuteEnabled} websiteId={site.id} />
                {/* Existing-data migration path (brand-voice-isolation fix, 2026-10-16): only
                    meaningful once this company has more than one site to split one out of. */}
                {companyWebsites.length > 1 && <SplitCompanyButton websiteId={site.id} />}
              </div>
            );
          })}

          <AddWebsiteForm
            companies={[...companyNameByProfileId].map(([id, name]) => ({ id, name: name ?? id }))}
            key={prefill.initialUrl}
            initialUrl={prefill.pendingId ? '' : prefill.initialUrl}
          />
        </CardContent>
      </Card>

      <div id="memory" className="scroll-mt-24">{memory && <MarketingMemoryPanel memory={memory} />}</div>

      {clientProfile && profileSuggestions.length > 0 && (
        <ProfileSuggestionsPanel suggestions={profileSuggestions} websiteId={selected.id} clientProfileId={clientProfile.id} />
      )}

      {clientProfile && (
        <div id="channels" className="scroll-mt-24">
        <SocialProfilesPanel clientProfileId={clientProfile.id} profiles={clientProfile.socialProfiles as unknown as SocialProfileItem[]} />
        </div>
      )}

      {clientProfile && (
        <div id="competitors" className="scroll-mt-24">
          <CompetitorListPanel clientProfileId={clientProfile.id} initialCompetitors={competitors} />
        </div>
      )}

      {clientProfile && (
        <Card id="preferences" className="mt-6 scroll-mt-24">
          <CardHeader>
            <CardTitle>Brand, content &amp; regional preferences</CardTitle>
            <CardDescription>
              These already shape every draft Dex generates. Change them here — they take effect on the next draft.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BrandPreferencesForm
              initial={{
                clientProfileId: clientProfile.id,
                brandVoice: clientProfile.brandVoice,
                audience: clientProfile.audience,
                approvedClaims: clientProfile.approvedClaims,
                restrictedWording: clientProfile.restrictedWording,
                markets: clientProfile.markets,
                languages: clientProfile.languages,
              }}
            />
          </CardContent>
        </Card>
      )}

      <LearningSection
        candidates={candidates.map((c) => ({
          ...c,
          websiteUrl: c.website.url,
          evaluationStatus: c.evaluation?.status ?? null,
          evaluatedPhrase: c.evaluation?.evaluatedPhrase ?? null,
          isActive: c.evaluation ? clientProfile!.restrictedWording.includes(c.evaluation.evaluatedPhrase) : false,
        }))}
      />

      <Card id="scan" className="mt-6 scroll-mt-24">
        <CardHeader>
          <CardTitle>Scan experience</CardTitle>
          <CardDescription>Choose what happens when a scan finishes. Applies to this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <GamePreferenceForm initial={customer.gamePreference} />
        </CardContent>
      </Card>

      <Card id="appearance" className="mt-6 scroll-mt-24">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how Dex looks for you.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>
    </main>
  );
}
