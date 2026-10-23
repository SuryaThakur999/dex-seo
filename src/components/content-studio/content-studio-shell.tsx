'use client';

import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { PlatformIcon, PLATFORM_LABELS } from './platform-icon';
import { PlatformPreview, PlatformPreviewHeader } from './platform-preview';
import { ProofShield } from './proof-shield';
import { EvidenceSourcePicker, type PickedEvidence } from './evidence-source-picker';
import { ALL_PLATFORMS } from '@/lib/content-studio/registry';
import { CONTENT_OBJECTIVES } from '@/lib/content-studio/adapter-types';
import { readFindingEvidence } from '@/lib/content-studio/evidence';
import type { ProofCheckResult } from '@/lib/proof-layer';
// Type-only: erased at build time, so the client bundle stays Node-free while
// the label maps below are still checked against the schema enums.
import type { ContentPlatform, ContentStatus } from '@prisma/client';
import { ThinkingOrb } from 'thinking-orbs';
import { SiteSwitcher } from '@/components/app-shell/site-switcher';
import { isGermanMarket } from '@/lib/is-german-market';

export interface ContentVariantView {
  index: number;
  angle: string;
  draftContent: unknown;
  status: ContentStatus;
  failureReason: string | null;
  tokenCost: number;
  proofChecks: ProofCheckResult[] | null;
}

export interface ContentPieceView {
  id: string;
  platform: ContentPlatform;
  topic: string;
  status: ContentStatus;
  failureReason: string | null;
  draftContent: unknown;
  audience: string | null;
  objective: string | null;
  market: string | null;
  language: string | null;
  tokenCost: number | null;
  proofChecks: ProofCheckResult[] | null;
  createdAt: string;
  sourceAction: { pageUrl: string; actionType: string } | null;
  evidence?: unknown;
  /** S2 pieces have 3 stable-indexed variants; a legacy pre-S2 piece has none (empty array),
   * in which case the card falls back to this piece's own draftContent/status/etc. fields. */
  variants?: ContentVariantView[];
}

const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'Draft',
  needs_assets: 'Needs assets',
  needs_review: 'Needs review',
  approved: 'Approved',
  ready_to_publish: 'Ready to publish',
  published: 'Published',
  failed: 'Failed',
  archived: 'Archived',
};

const NEXT_STATUS: Partial<Record<ContentStatus, ContentStatus[]>> = {
  draft: ['needs_review'],
  needs_assets: ['needs_review'],
  needs_review: ['approved', 'failed'],
  approved: ['ready_to_publish'],
  ready_to_publish: ['published'],
};

// Directive point 3: "Lifecycle tabs: Drafts; Ready; Failed; Archived" — grouped by real
// ContentStatus rows, not the raw 8-state enum a customer has no reason to think in.
const LIFECYCLE_TABS = [
  { value: 'drafts', label: 'Drafts', statuses: ['draft', 'needs_assets', 'needs_review'] as ContentStatus[] },
  { value: 'ready', label: 'Ready', statuses: ['approved', 'ready_to_publish', 'published'] as ContentStatus[] },
  { value: 'failed', label: 'Failed', statuses: ['failed'] as ContentStatus[] },
  { value: 'archived', label: 'Archived', statuses: ['archived'] as ContentStatus[] },
] as const;
type LifecycleTab = (typeof LIFECYCLE_TABS)[number]['value'];

function nextActionLabel(piece: ContentPieceView): string {
  switch (piece.status) {
    case 'draft':
      return 'Move to Needs review when ready.';
    case 'needs_assets':
      return 'Missing required fields for this platform — edit before it can move forward.';
    case 'needs_review':
      return 'Waiting on your review before approval.';
    case 'approved':
      return 'Ready to move to Ready to publish.';
    case 'ready_to_publish':
      return 'Copy the export and publish it on the platform yourself — no publishing integration is connected.';
    case 'published':
      return 'Published. No action needed.';
    case 'failed':
      return 'Generation failed — retry or archive.';
    case 'archived':
      return 'Archived. No action needed.';
  }
}

export function ContentStudioShell({
  clientProfileId,
  websiteId,
  websiteUrl,
  websites = [],
  websiteConfirmed = true,
  profileName,
  findings = [],
  initialPieces,
  pendingActions,
  clientProfileDefaults,
  initialPlatform,
  initialTopic,
  initialSourceActionId,
  initialSourceFindingId,
}: {
  clientProfileId: string;
  websiteId?: string;
  websiteUrl?: string;
  websites?: { id: string; url: string }[];
  websiteConfirmed?: boolean;
  profileName?: string;
  findings?: { id: string; ruleId: string; pageUrl: string }[];
  initialPieces: ContentPieceView[];
  pendingActions: { id: string; pageUrl: string; actionType: string }[];
  clientProfileDefaults: { audience: string | null; markets: string[]; languages: string[] };
  initialPlatform?: ContentPlatform;
  initialTopic?: string;
  initialSourceActionId?: string;
  initialSourceFindingId?: string;
}) {
  const [entryMode, setEntryMode] = useState<'opportunity' | 'topic'>(
    initialSourceActionId || initialSourceFindingId || (!initialTopic && findings.length > 0) ? 'opportunity' : 'topic'
  );
  const [platform, setPlatform] = useState<ContentPlatform>(initialPlatform ?? 'linkedin');
  const [topic, setTopic] = useState(initialTopic ?? '');
  const [sourceActionId, setSourceActionId] = useState(initialSourceActionId ?? '');
  const [sourceFindingId, setSourceFindingId] = useState(initialSourceFindingId ?? '');
  const [audience, setAudience] = useState(clientProfileDefaults.audience ?? '');
  const [objective, setObjective] = useState('');
  const [market, setMarket] = useState(clientProfileDefaults.markets[0] ?? '');
  const [language, setLanguage] = useState(
    isGermanMarket(clientProfileDefaults.markets[0] ?? '') && clientProfileDefaults.languages.includes('German')
      ? 'German'
      : clientProfileDefaults.languages[0] ?? ''
  );
  const [pieces, setPieces] = useState<ContentPieceView[]>(initialPieces);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [lifecycleTab, setLifecycleTab] = useState<LifecycleTab>('drafts');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialPieces[0]?.id ?? null);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [attachedEvidence, setAttachedEvidence] = useState<PickedEvidence | null>(null);
  const topicInputRef = useRef<HTMLInputElement>(null);

  function selectPiece(id: string) {
    setSelectedId(id);
    setSelectedVariantIndex(0);
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content-studio/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientProfileId,
          websiteId,
          platform,
          topic,
          sourceActionId: entryMode === 'opportunity' && sourceActionId ? sourceActionId : undefined,
          sourceFindingId: entryMode === 'opportunity' && sourceFindingId ? sourceFindingId : undefined,
          sourceEvidenceId: attachedEvidence?.id,
          audience: audience || undefined,
          objective: objective || undefined,
          market: market || undefined,
          language: language || undefined,
        }),
      });
      if (!res.ok) {
        const responseBody = await res.json().catch(() => ({}));
        throw new Error(responseBody.error ?? 'Something went wrong.');
      }
      const piece = (await res.json()) as ContentPieceView;
      setPieces((prev) => [piece, ...prev]);
      selectPiece(piece.id);
      setLifecycleTab(piece.status === 'failed' ? 'failed' : 'drafts');
      setTopic('');
      setAttachedEvidence(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(id: string, status: ContentStatus) {
    setError(null);
    try {
      const res = await fetch(`/api/content-studio/drafts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const responseBody = await res.json().catch(() => ({}));
        throw new Error(responseBody.error ?? 'Something went wrong.');
      }
      const updated = (await res.json()) as ContentPieceView;
      setPieces((prev) => prev.map((p) => (p.id === id ? { ...p, ...updated } : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  async function handleRetry(id: string, variantIndex: number) {
    setError(null);
    setRetryingId(id);
    try {
      const res = await fetch(`/api/content-studio/drafts/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: variantIndex }),
      });
      if (!res.ok) {
        const responseBody = await res.json().catch(() => ({}));
        throw new Error(responseBody.error ?? 'Retry failed.');
      }
      const updated = (await res.json()) as ContentPieceView;
      setPieces((prev) => prev.map((p) => (p.id === id ? { ...p, ...updated } : p)));
      if (updated.status !== 'failed') setLifecycleTab('drafts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setRetryingId(null);
    }
  }

  function focusCreationPanel() {
    setEntryMode('topic');
    topicInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    topicInputRef.current?.focus();
  }

  const tabCounts = useMemo(() => {
    const counts: Record<LifecycleTab, number> = { drafts: 0, ready: 0, failed: 0, archived: 0 };
    for (const p of pieces) {
      const tab = LIFECYCLE_TABS.find((t) => (t.statuses as ContentStatus[]).includes(p.status));
      if (tab) counts[tab.value]++;
    }
    return counts;
  }, [pieces]);

  const visiblePieces = useMemo(() => {
    const activeStatuses = LIFECYCLE_TABS.find((t) => t.value === lifecycleTab)!.statuses as ContentStatus[];
    const q = search.trim().toLowerCase();
    return pieces
      .filter((p) => activeStatuses.includes(p.status))
      .filter((p) => !q || p.topic.toLowerCase().includes(q))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [pieces, lifecycleTab, search]);

  const selectedPiece = pieces.find((p) => p.id === selectedId) ?? visiblePieces[0] ?? null;
  const selectedEvidence = readFindingEvidence(selectedPiece?.evidence);
  // A legacy pre-S2 piece has variants: [] (never migrated) — fall back to the piece's own
  // fields rather than treating "no variant at the selected index" as a missing draft.
  const activeVariant: ContentVariantView | null =
    selectedPiece && selectedPiece.variants && selectedPiece.variants.length > 0
      ? selectedPiece.variants.find((v) => v.index === selectedVariantIndex) ?? selectedPiece.variants[0]
      : null;
  const activeStatus = activeVariant?.status ?? selectedPiece?.status;
  const activeFailureReason = activeVariant?.failureReason ?? selectedPiece?.failureReason;
  const activeDraftContent = activeVariant?.draftContent ?? selectedPiece?.draftContent;
  const activeProofChecks = activeVariant?.proofChecks ?? selectedPiece?.proofChecks ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* Point 1 + 6: header — search, New draft, and platform connection state shown once. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search drafts by topic"
          aria-label="Search drafts"
          className="h-9 w-64 max-w-full rounded-md border border-border bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button variant="accent" onClick={focusCreationPanel}>
          + New draft
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1" aria-hidden="true">
          {ALL_PLATFORMS.map((p) => (
            <PlatformIcon key={p} platform={p} size={14} />
          ))}
        </span>
        <span>Dex writes the post. You copy it and publish it yourself. Nothing is posted automatically.</span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-5">
        {/* Point 2: creation entry points. */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <Tabs value={entryMode} onValueChange={(v) => setEntryMode(v as typeof entryMode)}>
              <TabsList>
                <TabsTrigger value="opportunity">From opportunity</TabsTrigger>
                <TabsTrigger value="topic">From topic</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="flex flex-col gap-3">
              {/* Drafts are grounded in this website's profile and findings, so the choice sits first. */}
              {websiteConfirmed && websiteId && websites.length > 0 ? (
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span>Website</span>
                  <SiteSwitcher websites={websites} currentWebsiteId={websiteId} profileName={profileName} hrefPattern="/studio?websiteId={id}" />
                </div>
              ) : (
                <div role="status" className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium text-foreground">Add your website first</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Drafts are built from your website&apos;s pages and findings.{' '}
                    <a className="text-accent underline-offset-4 hover:underline" href={websiteId ? `/dashboard/${websiteId}` : '/dashboard'}>Add it on the dashboard</a>.
                  </p>
                </div>
              )}
              <EvidenceSourcePicker websiteId={websiteId} onEvidenceLoaded={setAttachedEvidence} />
              {attachedEvidence && (
                <div className="flex flex-col gap-1 rounded-md border border-border p-2 text-xs">
                  <span className="text-muted-foreground">Evidence loaded</span>
                  <span className="break-words text-foreground">{attachedEvidence.canonicalUrl}</span>
                  <span className="break-words text-muted-foreground">{attachedEvidence.excerpt}</span>
                </div>
              )}
              {entryMode === 'opportunity' && (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Crawl finding
                  <select
                    value={sourceFindingId}
                    onChange={(e) => setSourceFindingId(e.target.value)}
                    className="h-11 rounded-md border border-border bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">No linked finding</option>
                    {findings.map((finding) => (
                      <option key={finding.id} value={finding.id}>{finding.ruleId}: {finding.pageUrl}</option>
                    ))}
                  </select>
                  {findings.length === 0 && websiteConfirmed && (
                    <span>
                      No crawl findings for {websiteUrl} yet.{' '}
                      <a className="text-accent underline-offset-4 hover:underline" href={`/dashboard/${websiteId}`}>Run a scan</a> to build drafts from real page evidence.
                    </span>
                  )}
                </label>
              )}
              {entryMode === 'opportunity' && pendingActions.length > 0 && (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Source action (optional)
                  <select
                    value={sourceActionId}
                    onChange={(e) => setSourceActionId(e.target.value)}
                    className="h-9 rounded-md border border-border bg-transparent px-3 text-sm text-foreground"
                  >
                    <option value="">No linked action</option>
                    {pendingActions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.actionType} — {a.pageUrl}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Topic
                <input
                  ref={topicInputRef}
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What's this post about?"
                  className="h-11 rounded-md border border-[var(--dex-app-border-strong)] bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Audience
                  <input
                    type="text"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="Not specified"
                    className="h-9 rounded-md border border-border bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Objective
                  <select
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    className="h-9 rounded-md border border-border bg-transparent px-3 text-sm text-foreground"
                  >
                    <option value="">Not specified</option>
                    {CONTENT_OBJECTIVES.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Market
                  <select
                    value={market}
                    onChange={(e) => setMarket(e.target.value)}
                    disabled={clientProfileDefaults.markets.length === 0}
                    className="h-9 rounded-md border border-border bg-transparent px-3 text-sm text-foreground disabled:opacity-50"
                  >
                    {clientProfileDefaults.markets.length === 0 ? (
                      <option value="">Add markets in Settings</option>
                    ) : (
                      clientProfileDefaults.markets.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Language
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    disabled={clientProfileDefaults.languages.length === 0}
                    className="h-9 rounded-md border border-border bg-transparent px-3 text-sm text-foreground disabled:opacity-50"
                  >
                    {clientProfileDefaults.languages.length === 0 ? (
                      <option value="">Add languages in Settings</option>
                    ) : (
                      clientProfileDefaults.languages.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Platform
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as ContentPlatform)}
                  className="h-9 rounded-md border border-border bg-transparent px-3 text-sm text-foreground"
                >
                  {ALL_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="accent" disabled={loading || !topic.trim() || !websiteConfirmed} className="h-11">
                {loading ? <><ThinkingOrb state="composing" size={20} theme="dark" aria-hidden="true" className="mr-2" />Drafting…</> : 'Generate reviewed draft'}
              </Button>
              {!topic.trim() && websiteConfirmed && <p className="text-xs text-muted-foreground">Add a topic or pick a source</p>}
              <p className="text-xs text-muted-foreground">Uses saved business context and approved claims. Select a finding to include crawl evidence.</p>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </form>
          </CardContent>
        </Card>

        {/* Point 4/5: platform-faithful preview + Proof Shield for the selected draft. */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline">Preview — not published</Badge>
              {selectedPiece && <PlatformPreviewHeader platform={selectedPiece.platform} />}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!selectedPiece && <p className="text-sm text-muted-foreground">No draft selected yet.</p>}
            {/* Point: surface all 3 generated angles, not just variant 0 — each has its own
                status/content/Proof Shield, so a failure in one angle doesn't hide the other two. */}
            {selectedPiece && selectedPiece.variants && selectedPiece.variants.length > 0 && (
              <div className="flex gap-2">
                {selectedPiece.variants.map((v) => (
                  <Button
                    key={v.index}
                    size="sm"
                    variant={v.index === selectedVariantIndex ? 'accent' : 'outline'}
                    onClick={() => setSelectedVariantIndex(v.index)}
                  >
                    {v.angle || `Angle ${v.index + 1}`}
                    {v.status === 'failed' && <Badge variant="destructive" className="ml-2">Failed</Badge>}
                  </Button>
                ))}
              </div>
            )}
            {selectedPiece && activeStatus === 'failed' && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-destructive">{activeFailureReason ?? 'Generation failed.'}</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retryingId === selectedPiece.id}
                  onClick={() => handleRetry(selectedPiece.id, activeVariant?.index ?? 0)}
                >
                  {retryingId === selectedPiece.id ? 'Retrying…' : 'Retry'}
                </Button>
              </div>
            )}
            {selectedPiece && activeStatus !== 'failed' && (
              <PlatformPreview platform={selectedPiece.platform} draft={activeDraftContent} />
            )}
            {selectedPiece && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
                <span className="text-muted-foreground">Audience</span>
                <span className="text-foreground">{selectedPiece.audience ?? 'Not specified'}</span>
                <span className="text-muted-foreground">Objective</span>
                <span className="text-foreground">{selectedPiece.objective ?? 'Not specified'}</span>
                <span className="text-muted-foreground">Market</span>
                <span className="text-foreground">{selectedPiece.market ?? 'Not specified'}</span>
                <span className="text-muted-foreground">Language</span>
                <span className="text-foreground">{selectedPiece.language ?? 'Not specified'}</span>
                <span className="text-muted-foreground">Built from</span>
                <span className="break-words text-foreground">
                  {selectedEvidence ? <>{selectedEvidence.ruleId}: {selectedEvidence.pageUrl}<br />Retrieved: {selectedEvidence.retrievedAt}{selectedEvidence.limitations && <><br />Limitations: {selectedEvidence.limitations}</>}</> : 'No linked crawl finding'}
                </span>
                {selectedPiece.sourceAction && <><span className="text-muted-foreground">Source action</span><span className="break-words text-foreground">{selectedPiece.sourceAction.actionType}: {selectedPiece.sourceAction.pageUrl}</span></>}
              </div>
            )}
            {selectedPiece && (
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">Proof Shield</p>
                <ProofShield checks={activeProofChecks} />
              </div>
            )}
            {selectedPiece && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">{nextActionLabel(selectedPiece)}</p>
                <div className="flex flex-wrap gap-2">
                  {(NEXT_STATUS[selectedPiece.status] ?? []).map((status) => {
                    const isUnconnectedPublish = selectedPiece.status === 'ready_to_publish' && status === 'published';
                    if (isUnconnectedPublish) {
                      return (
                        <Tooltip key={status}>
                          <TooltipTrigger asChild>
                            {/* Button's own `disabled:pointer-events-none` class blocks hover on
                                the button itself, so the tooltip trigger sits on this wrapping span. */}
                            <span tabIndex={0} className="inline-block">
                              <Button size="sm" variant="outline" disabled>
                                {STATUS_LABELS[status]}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Publishing isn&apos;t connected for this platform yet.</TooltipContent>
                        </Tooltip>
                      );
                    }
                    return (
                      <Button
                        key={status}
                        size="sm"
                        variant="outline"
                        onClick={() => handleStatusChange(selectedPiece.id, status)}
                      >
                        {STATUS_LABELS[status]}
                      </Button>
                    );
                  })}
                  {selectedPiece.status !== 'failed' && (
                    <a
                      href={`/api/content-studio/drafts/${selectedPiece.id}/export`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-foreground hover:opacity-90"
                    >
                      Copy export
                    </a>
                  )}
                  {/* Point 7: Archive moved into an overflow menu — a native <details> disclosure
                      widget, so keyboard/screen-reader support comes from the platform, not
                      hand-rolled JS. */}
                  {selectedPiece.status !== 'archived' && (
                    <details className="relative inline-block">
                      <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted">
                        ⋯
                      </summary>
                      <div className="absolute right-0 z-10 mt-1 rounded-md border border-border bg-popover p-1 shadow-md">
                        <button
                          type="button"
                          onClick={() => handleStatusChange(selectedPiece.id, 'archived')}
                          className="whitespace-nowrap rounded px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                        >
                          Archive
                        </button>
                      </div>
                    </details>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Point 3: lifecycle tabs + list. */}
      <Tabs value={lifecycleTab} onValueChange={(v) => setLifecycleTab(v as LifecycleTab)}>
        <TabsList>
          {LIFECYCLE_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label} ({tabCounts[t.value]})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visiblePieces.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {pieces.length === 0 ? 'No drafts yet. Pick a platform and a topic above.' : 'No drafts match this view.'}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {visiblePieces.map((piece) => (
          <button
            key={piece.id}
            type="button"
            onClick={() => selectPiece(piece.id)}
            className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
              piece.id === selectedPiece?.id ? 'border-accent bg-accent/5' : 'border-border hover:bg-muted'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <PlatformIcon platform={piece.platform} size={18} />
              <span className="truncate font-medium text-foreground">{piece.topic}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <span>
                {piece.language ?? '—'} / {piece.market ?? '—'}
              </span>
              <Badge variant={piece.status === 'failed' ? 'destructive' : 'outline'}>{STATUS_LABELS[piece.status]}</Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
