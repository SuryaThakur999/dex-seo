import { describe, it, expect } from 'vitest';
import { redditAdapter } from './reddit';
import { buildGroundingBlock, type DraftPromptInput } from '../adapter-types';
import { CONTENT_STRUCTURES } from '../playbook-shared';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Honest, no marketing-speak', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
  audience: null,
  objective: null,
  market: null,
  language: null,
};

describe('redditAdapter', () => {
  it('builds instructions with no hashtag mention (not a Reddit convention), with structure and discussion-CTA guidance', () => {
    const instructions = redditAdapter.buildInstructions();
    expect(instructions).not.toContain('hashtag');
    expect(instructions).toContain('PAS');
    expect(instructions).toContain('contrarian');
    expect(instructions).toContain('discussion prompt');
  });

  it('folds the topic into the untrusted grounding envelope', () => {
    expect(buildGroundingBlock(input)).toContain('spring sale');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({
      hook: 'Anyone else overspend on ads this spring?',
      title: 'Our spring sale',
      body: 'Details here.',
      structure: 'story',
      cta: 'Has anyone else run into this?',
      suggestedSubreddits: ['smallbusiness'],
    });
    expect(redditAdapter.parseModelOutput(raw)).toEqual({
      hook: 'Anyone else overspend on ads this spring?',
      title: 'Our spring sale',
      body: 'Details here.',
      structure: 'story',
      cta: 'Has anyone else run into this?',
      suggestedSubreddits: ['smallbusiness'],
    });
  });

  it('falls back to raw text as body with empty other fields on invalid JSON', () => {
    expect(redditAdapter.parseModelOutput('not json')).toEqual({
      hook: '',
      title: '',
      body: 'not json',
      structure: '',
      cta: '',
      suggestedSubreddits: [],
    });
  });

  it('flags an empty title as invalid', () => {
    const result = redditAdapter.validate({
      hook: 'Hook.',
      title: '',
      body: 'Details.',
      structure: 'PAS',
      cta: 'Thoughts?',
      suggestedSubreddits: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('title'))).toBe(true);
  });

  it('flags a title over 300 characters as invalid', () => {
    const result = redditAdapter.validate({
      hook: 'Hook.',
      title: 'a'.repeat(301),
      body: 'Details.',
      structure: 'PAS',
      cta: 'Thoughts?',
      suggestedSubreddits: [],
    });
    expect(result.valid).toBe(false);
  });

  it('flags a banned AI-filler phrase in the body', () => {
    const result = redditAdapter.validate({
      hook: 'Look no further.',
      title: 'Our spring sale',
      body: 'Look no further.',
      structure: 'PAS',
      cta: 'Thoughts?',
      suggestedSubreddits: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('banned AI-filler'))).toBe(true);
  });

  it('accepts a valid draft with hook, structure, and CTA present', () => {
    const result = redditAdapter.validate({
      hook: 'Anyone else overspend on ads this spring?',
      title: 'Our spring sale',
      body: 'Details.',
      structure: 'story',
      cta: 'Has anyone else run into this?',
      suggestedSubreddits: [],
    });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('golden: each of the three structures produces a valid draft with hook, structure, and CTA', () => {
    for (const structure of CONTENT_STRUCTURES) {
      const result = redditAdapter.validate({
        hook: `Opening line for ${structure}.`,
        title: 'Our spring sale',
        body: `Opening line for ${structure}. Rest of the body.`,
        structure,
        cta: 'Has anyone else run into this?',
        suggestedSubreddits: [],
      });
      expect(result.valid).toBe(true);
    }
  });

  it('formats export as title, body, and suggested subreddits', () => {
    const text = redditAdapter.formatExport({
      hook: 'Anyone else overspend on ads this spring?',
      title: 'Our spring sale',
      body: 'Details here.',
      structure: 'PAS',
      cta: 'Thoughts?',
      suggestedSubreddits: ['smallbusiness', 'retail'],
    });
    expect(text).toBe('Title: Our spring sale\n\nDetails here.\n\nSuggested subreddits: r/smallbusiness, r/retail');
  });
});
