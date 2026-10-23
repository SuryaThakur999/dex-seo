import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
const drag = vi.hoisted(() => ({ end: undefined as undefined | ((event: unknown, info: unknown) => void), ends: [] as ((event: unknown, info: unknown) => void)[], refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: drag.refresh }) }));
vi.mock('motion/react', () => ({ useReducedMotion: () => true, motion: { div: (props: Record<string, unknown>) => {
  drag.end = props.onDragEnd as typeof drag.end;
  if (drag.end) drag.ends.push(drag.end);
  return React.createElement('div', { className: props.className }, props.children as React.ReactNode);
} } }));
import { ReviewQueueList, shouldCommitSwipe, actionTypeBadgeLabel, pagePathLabel } from './review-queue-list';

describe('quick decisions', () => {
  it.each(['Approve', 'Reject'])('keeps row A stale when row B fails on %s', async (label) => {
    vi.stubGlobal('React', React);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    drag.ends = [];
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'Action changed. Reload before deciding.' }) })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    vi.stubGlobal('fetch', request);
    const container = document.createElement('div');
    const root = createRoot(container);
    const row = { id: 'a1', revision: 'old-revision', actionType: 'meta_description', pageUrl: 'https://example.test', draftContent: 'Old draft', createdAt: new Date(), guardResult: null, generationStatus: 'succeeded' };
    const rows = [row, { ...row, id: 'a2' }];
    const swipe = { offset: { x: -100, y: 0 }, velocity: { x: 0, y: 0 } };
    const buttons = () => Array.from(container.querySelectorAll('button')).filter(element => element.textContent === label);
    try {
      await act(async () => root.render(React.createElement(ReviewQueueList, { actions: rows, selectedActionId: null })));
      const [openA, openB] = drag.ends;
      await act(async () => openA({}, swipe));
      await act(async () => buttons()[0].click());
      expect(buttons()[0].disabled).toBe(true);
      await act(async () => openB({}, swipe));
      await act(async () => buttons()[1].click());
      expect(buttons()[0].disabled).toBe(true);
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
      expect(container.textContent).toContain('Action changed. Reload before deciding.');
      expect(container.textContent).toContain(`Could not ${label.toLowerCase()} this page. Try again.`);
      await act(async () => openA({}, swipe));
      await act(async () => buttons()[0].click());
      expect(request).toHaveBeenCalledTimes(2);
      await act(async () => root.render(React.createElement(ReviewQueueList, { actions: rows, selectedActionId: null })));
      expect(buttons()[0].disabled).toBe(true);
      await act(async () => root.render(React.createElement(ReviewQueueList, { actions: [{ ...row, revision: 'fresh-revision' }, rows[1]], selectedActionId: null })));
      expect(buttons()[0].disabled).toBe(false);
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(container.textContent).not.toContain('Action changed. Reload before deciding.');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
  it.each(['Approve', 'Reject'])('offers reload and prevents stale retries after a409 on %s', async (label) => {
    vi.stubGlobal('React', React);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    drag.refresh.mockClear();
    const request = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'Action changed. Reload before deciding.' }) });
    vi.stubGlobal('fetch', request);
    const container = document.createElement('div');
    const root = createRoot(container);
    const row = { id: 'a1', revision: 'old-revision', actionType: 'meta_description', pageUrl: 'https://example.test', draftContent: 'Old draft', createdAt: new Date(), guardResult: null, generationStatus: 'succeeded' };
    try {
      await act(async () => root.render(React.createElement(ReviewQueueList, { actions: [row], selectedActionId: null })));
      await act(async () => drag.end?.({}, { offset: { x: -100, y: 0 }, velocity: { x: 0, y: 0 } }));
      const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent === label)!;
      await act(async () => button.click());
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Action changed. Reload before deciding.');
      expect(button.disabled).toBe(true);
      await act(async () => button.click());
      expect(request).toHaveBeenCalledOnce();
      const reload = Array.from(container.querySelectorAll('button')).find(element => element.textContent === 'Reload queue')!;
      expect(reload).toBeDefined();
      await act(async () => reload.click());
      expect(drag.refresh).toHaveBeenCalledOnce();
      await act(async () => root.render(React.createElement(ReviewQueueList, { actions: [{ ...row, revision: 'fresh-revision', draftContent: 'Changed draft' }], selectedActionId: null })));
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(button.disabled).toBe(false);
      await act(async () => button.click());
      expect(request.mock.calls[1][1].body.get('expectedRevision')).toBe('fresh-revision');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
  it.each(['Approve', 'Reject'])('submits the displayed server revision on %s', async (label) => {
    vi.stubGlobal('React', React);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const request = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', request);
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(React.createElement(ReviewQueueList, {
        actions: [{ id: 'a1', revision: 'displayed-revision', actionType: 'meta_description', pageUrl: 'https://example.test', draftContent: 'Displayed draft', createdAt: new Date(), guardResult: null, generationStatus: 'succeeded' }], selectedActionId: null,
      })));
      await act(async () => drag.end?.({}, { offset: { x: -100, y: 0 }, velocity: { x: 0, y: 0 } }));
      const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent === label)!;
      await act(async () => button.click());
      expect(request).toHaveBeenCalledOnce();
      const [url, options] = request.mock.calls[0];
      expect(url).toBe('/api/actions/a1/' + label.toLowerCase());
      expect(options.method).toBe('POST');
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('expectedRevision')).toBe('displayed-revision');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  // Item 2 (overseer production check, 2026-10-16): the row's fix-type badge showed only the
  // technical term, forced uppercase by Badge's own CSS -- reading like a raw enum constant
  // ("CANONICAL TAG FIX") for a multi-word phrase. Same plain-language-first pattern as
  // ActionDetail and the Opportunity Board: a plain summary leads, the existing term is kept
  // small underneath instead of being the only thing shown.
  it('leads with a plain-language summary and keeps the technical term small underneath, not uppercased', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const row = { id: 'a1', revision: 'rev', actionType: 'canonical_fix', pageUrl: 'https://example.test', draftContent: 'Draft', createdAt: new Date(), guardResult: null, generationStatus: 'succeeded' };
    try {
      await act(async () => root.render(React.createElement(ReviewQueueList, { actions: [row], selectedActionId: null })));
      expect(container.textContent).toContain('Tell Google which page is the main one');
      const technical = Array.from(container.querySelectorAll('span')).find((el) => el.textContent === 'Canonical tag fix');
      expect(technical).toBeTruthy();
      expect(technical?.className).not.toContain('uppercase');
    } finally {
      await act(async () => root.unmount());
    }
  });
});

describe('shouldCommitSwipe', () => {
  const revealWidth = 140;

  it('commits when distance exceeds 40% of reveal width', () => {
    expect(shouldCommitSwipe(60, 0, revealWidth)).toBe(true);
  });

  it('commits when velocity exceeds the threshold even with a short distance', () => {
    expect(shouldCommitSwipe(10, 200, revealWidth)).toBe(true); // 200 px/s > 110 px/s (0.11 px/ms)
  });

  it('does not commit when both distance and velocity are under threshold', () => {
    expect(shouldCommitSwipe(20, 50, revealWidth)).toBe(false);
  });

  it('treats negative (leftward) distance and velocity the same as positive magnitude', () => {
    expect(shouldCommitSwipe(-60, 0, revealWidth)).toBe(true);
    expect(shouldCommitSwipe(-10, -200, revealWidth)).toBe(true);
  });
});

// Issue 1 (live-review-ux-fixes): with 100+ pending rows, several can share one URL with
// different actionTypes and look identical until opened. actionTypeBadgeLabel resolves the
// per-row badge text; extracted as a pure function because ReviewQueueList itself uses
// useSearchParams and can't be rendered outside a real Next.js router context.
describe('actionTypeBadgeLabel', () => {
  it('resolves a known actionType to its human-readable label', () => {
    expect(actionTypeBadgeLabel('meta_description')).toBe('Meta description change');
    expect(actionTypeBadgeLabel('canonical_fix')).toBe('Canonical tag fix');
    expect(actionTypeBadgeLabel('internal_link_fix')).toBe('Internal link suggestion');
  });

  it('falls back to the raw actionType for a value with no label yet, rather than hiding it', () => {
    expect(actionTypeBadgeLabel('some_future_type')).toBe('some_future_type');
  });
});

// Dashboard audit item 10: the full URL left mobile rows showing little past "https://…", with
// no room for the fix-type badge. The path (plus query string) is what actually distinguishes
// one page from another on the same site.
describe('pagePathLabel', () => {
  it('returns the path and query string, dropping scheme and host', () => {
    expect(pagePathLabel('https://example.com/preise?ref=ads')).toBe('/preise?ref=ads');
  });

  it('returns / for the homepage', () => {
    expect(pagePathLabel('https://example.com')).toBe('/');
    expect(pagePathLabel('https://example.com/')).toBe('/');
  });

  it('returns the raw input for an unparseable URL instead of throwing', () => {
    expect(pagePathLabel('not a url')).toBe('not a url');
  });
});
