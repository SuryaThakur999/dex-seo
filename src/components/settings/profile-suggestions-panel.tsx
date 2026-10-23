'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export type SuggestedProfileField = 'businessDescription' | 'audience' | 'markets' | 'languages' | 'brandVoice' | 'socialProfiles';

const FIELD_LABELS: Record<SuggestedProfileField, string> = {
  businessDescription: 'Business description',
  audience: 'Audience',
  brandVoice: 'Brand voice',
  markets: 'Markets',
  languages: 'Languages',
  socialProfiles: 'Social profiles',
};

interface SocialProfileValue {
  platform: string;
  url: string;
}

export interface ProfileSuggestionItem {
  id: string;
  field: SuggestedProfileField;
  valueJson: string | string[] | SocialProfileValue[];
  sourceUrl: string;
  sourceExcerpt: string;
  /** Memory refresh (2026-10-17): true when this clientProfile already has an accepted
   *  suggestion for this field -- labels the row honestly as an update, not new information. */
  isUpdate?: boolean;
}

function isSocialProfileArray(value: ProfileSuggestionItem['valueJson']): value is SocialProfileValue[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'object' && entry !== null && 'platform' in entry && 'url' in entry);
}

function displayValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn', xing: 'Xing', instagram: 'Instagram',
  facebook: 'Facebook', x: 'X', youtube: 'YouTube', tiktok: 'TikTok',
};

function SocialProfilesValue({ profiles }: { profiles: SocialProfileValue[] }) {
  return (
    <ul className="flex flex-col gap-1 text-base text-foreground sm:text-sm">
      {profiles.map((profile) => (
        <li key={profile.platform}>
          {PLATFORM_LABEL[profile.platform] ?? profile.platform}:{' '}
          <a href={profile.url} target="_blank" rel="noreferrer" className="underline">{profile.url}</a>
        </li>
      ))}
    </ul>
  );
}

const SOURCE_URL_DISPLAY_LENGTH = 40;

function formatSourceUrl(url: string): string {
  let display: string;
  try {
    const parsed = new URL(url);
    display = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, '') || parsed.hostname;
  } catch {
    display = url;
  }
  return display.length > SOURCE_URL_DISPLAY_LENGTH
    ? `${display.slice(0, SOURCE_URL_DISPLAY_LENGTH - 1)}…`
    : display;
}

function SuggestionRow({
  suggestion, websiteId, clientProfileId, onDecided,
}: {
  suggestion: ProfileSuggestionItem;
  websiteId: string;
  clientProfileId: string;
  onDecided: (id: string) => void;
}) {
  const isSocialProfiles = isSocialProfileArray(suggestion.valueJson);
  const [editing, setEditing] = useState(false);
  const [editedValue, setEditedValue] = useState(isSocialProfiles ? '' : displayValue(suggestion.valueJson as string | string[]));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);

  async function decide(action: 'accept' | 'reject', value?: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/websites/${websiteId}/profile-suggestions/${suggestion.id}?clientProfileId=${encodeURIComponent(clientProfileId)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(value !== undefined ? { value } : {}) }) },
      );
      if (!res.ok) {
        setError('Something went wrong — try again.');
        return;
      }
      onDecided(suggestion.id);
    } catch {
      setError('Something went wrong — try again.');
    } finally {
      setPending(false);
    }
  }

  function saveEdit() {
    const value = Array.isArray(suggestion.valueJson)
      ? editedValue.split(',').map((v) => v.trim()).filter(Boolean)
      : editedValue;
    decide('accept', value);
  }

  return (
    <li className="flex min-w-0 flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
      <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <span className="text-sm font-medium text-foreground">{FIELD_LABELS[suggestion.field]}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground sm:text-right" title={suggestion.sourceUrl}>
          {suggestion.isUpdate ? 'Updated from' : 'AI-suggested from'} {formatSourceUrl(suggestion.sourceUrl)}
        </span>
      </div>
      {isSocialProfiles ? (
        <SocialProfilesValue profiles={suggestion.valueJson as SocialProfileValue[]} />
      ) : editing ? (
        <Textarea
          value={editedValue}
          onChange={(e) => setEditedValue(e.target.value)}
          rows={2}
          aria-label={`Edit suggested ${FIELD_LABELS[suggestion.field]}`}
        />
      ) : (
        <span className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground sm:text-sm">{displayValue(suggestion.valueJson as string | string[])}</span>
      )}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button size="sm" onClick={saveEdit} disabled={pending || !editedValue.trim()}>Save and accept</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setEditedValue(displayValue(suggestion.valueJson as string | string[])); }} disabled={pending}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => decide('accept')} disabled={pending}>Accept</Button>
            {!isSocialProfiles && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={pending}>Edit</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => decide('reject')} disabled={pending}>Reject</Button>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <button
        type="button"
        aria-expanded={showEvidence}
        aria-controls={`profile-suggestion-evidence-${suggestion.id}`}
        className="inline-flex min-h-11 w-fit items-center text-left text-xs text-muted-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setShowEvidence((v) => !v)}
      >
        {showEvidence ? 'Hide source excerpt' : 'Show source excerpt'}
      </button>
      {showEvidence && (
        <p id={`profile-suggestion-evidence-${suggestion.id}`} className="whitespace-pre-wrap break-words rounded-md border border-border p-3 text-xs text-muted-foreground">
          {suggestion.sourceExcerpt}
        </p>
      )}
    </li>
  );
}

export function ProfileSuggestionsPanel({
  suggestions, websiteId, clientProfileId,
}: {
  suggestions: ProfileSuggestionItem[];
  websiteId: string;
  clientProfileId: string;
}) {
  const [visible, setVisible] = useState(suggestions);
  if (visible.length === 0) return null;

  return (
    <Card className="mt-6" role="region" aria-label="AI-suggested Marketing Memory">
      <CardHeader>
        <CardTitle><h2>AI-suggested for Marketing Memory</h2></CardTitle>
        <CardDescription>
          Dex found these on your own pages. Nothing changes on your profile until you accept, edit, or reject each one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul aria-label="Pending AI-suggested facts" className="flex flex-col gap-4">
          {visible.map((suggestion) => (
            <SuggestionRow
              key={suggestion.id}
              suggestion={suggestion}
              websiteId={websiteId}
              clientProfileId={clientProfileId}
              onDecided={(id) => setVisible((current) => current.filter((s) => s.id !== id))}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
