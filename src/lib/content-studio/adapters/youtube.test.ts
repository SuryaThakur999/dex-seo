import { describe, it, expect } from 'vitest';
import { youtubeAdapter } from './youtube';
import { buildGroundingBlock, type DraftPromptInput } from '../adapter-types';
import { CONTENT_STRUCTURES } from '../playbook-shared';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Informative', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
  audience: null,
  objective: null,
  market: null,
  language: null,
};

const baseDraft = {
  hook: 'This mistake costs SMBs thousands.',
  title: 'Spring Sale Explained',
  thumbnailText: 'The real cost',
  description: 'Full details in this video.',
  tags: ['spring sale', 'smb marketing', 'seasonal promotions', 'ad budgets', 'retail planning'],
  targetQueries: ['spring sale ideas', 'smb ad budget', 'seasonal promotion tips'],
  script: 'Full script here.',
  structure: 'PAS' as const,
  cta: 'Subscribe for more.',
};

describe('youtubeAdapter', () => {
  it('builds instructions describing description as separate from the on-screen script, with hook, structure, CTA, pairing, and SEO guidance', () => {
    const instructions = youtubeAdapter.buildInstructions();
    expect(instructions).toContain('description');
    expect(instructions).toContain('script');
    expect(instructions).toContain('first 15 seconds');
    expect(instructions).toContain('PAS');
    expect(instructions).toContain('contrarian');
    expect(instructions).toContain('judged as a pair');
    expect(instructions).toContain('targetQueries');
    expect(instructions).toContain('ask for it rather than inventing one');
  });

  it('folds the topic into the untrusted grounding envelope', () => {
    expect(buildGroundingBlock(input)).toContain('spring sale');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify(baseDraft);
    expect(youtubeAdapter.parseModelOutput(raw)).toEqual(baseDraft);
  });

  it('falls back to raw text as script with empty other fields on invalid JSON', () => {
    expect(youtubeAdapter.parseModelOutput('not json')).toEqual({
      hook: '',
      title: '',
      thumbnailText: '',
      description: '',
      tags: [],
      targetQueries: [],
      script: 'not json',
      structure: '',
      cta: '',
    });
  });

  it('flags an empty title as invalid', () => {
    const result = youtubeAdapter.validate({ ...baseDraft, title: '' });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('title'))).toBe(true);
  });

  it('flags a title over 100 characters as invalid', () => {
    const result = youtubeAdapter.validate({ ...baseDraft, title: 'a'.repeat(101) });
    expect(result.valid).toBe(false);
  });

  it('flags a banned AI-filler phrase in the script', () => {
    const result = youtubeAdapter.validate({ ...baseDraft, hook: 'This is cutting-edge.', script: 'This is cutting-edge.' });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('banned AI-filler'))).toBe(true);
  });

  it('flags a thumbnail that exactly duplicates the title (pairing lint)', () => {
    const result = youtubeAdapter.validate({ ...baseDraft, thumbnailText: baseDraft.title });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('duplicates the title'))).toBe(true);
  });

  it.each(['', '   '])('rejects missing thumbnail text: %j', (thumbnailText) => {
    expect(youtubeAdapter.validate({ ...baseDraft, thumbnailText }).issues).toContain('Thumbnail text is required.');
  });

  it.each(['title', 'thumbnailText'] as const)('rejects vague wording in %s', (field) => {
    for (const wording of ["You won't believe these results", 'You won’t believe these results', 'Try this one trick']) {
      expect(youtubeAdapter.validate({ ...baseDraft, [field]: wording }).issues).toContain('Title and thumbnail text must avoid vague clickbait phrases.');
    }
  });

  it.each([0, 4, 9])('rejects %i tags', (count) => {
    expect(youtubeAdapter.validate({ ...baseDraft, tags: Array.from({ length: count }, (_, i) => `tag ${i}`) }).issues).toContain('Between 5 and 8 non-empty tags are required.');
  });

  it.each(['', '   '])('rejects a blank tag: %j', (tag) => {
    expect(youtubeAdapter.validate({ ...baseDraft, tags: [...baseDraft.tags.slice(0, 4), tag] }).issues).toContain('Between 5 and 8 non-empty tags are required.');
  });

  it.each([5, 8])('accepts %i non-empty tags', (count) => {
    expect(youtubeAdapter.validate({ ...baseDraft, tags: Array.from({ length: count }, (_, i) => `retail topic ${i}`) }).valid).toBe(true);
  });

  it.each(['', '   ', '...', '[query]', 'query 1', 'TBD'])('rejects a blank or placeholder query: %j', (query) => {
    expect(youtubeAdapter.validate({ ...baseDraft, targetQueries: [query, query, query] }).issues).toContain('Target search queries must be non-empty and must not be placeholders.');
  });

  it('flags a target query count other than 3', () => {
    const result = youtubeAdapter.validate({ ...baseDraft, targetQueries: ['one query'] });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('3 target search queries'))).toBe(true);
  });

  it('accepts a valid draft with hook, structure, CTA, a non-duplicate thumbnail, and 3 target queries', () => {
    const result = youtubeAdapter.validate(baseDraft);
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('golden: each of the three structures produces a valid draft with hook, structure, and CTA', () => {
    for (const structure of CONTENT_STRUCTURES) {
      const result = youtubeAdapter.validate({
        ...baseDraft,
        hook: `Opening line for ${structure}.`,
        script: `Opening line for ${structure}. Rest of the script.`,
        structure,
      });
      expect(result.valid).toBe(true);
    }
  });

  it('formats export as title, thumbnail text, description, tags, target queries, and script', () => {
    const text = youtubeAdapter.formatExport(baseDraft);
    expect(text).toBe(
      [
        'Title: Spring Sale Explained',
        'Thumbnail text: The real cost',
        'Description:\nFull details in this video.',
        'Tags: spring sale, smb marketing, seasonal promotions, ad budgets, retail planning',
        'Target search queries: spring sale ideas, smb ad budget, seasonal promotion tips',
        'Script:\nFull script here.',
      ].join('\n\n')
    );
  });

  it('formats export without optional lines when thumbnail text, tags, and queries are absent', () => {
    const text = youtubeAdapter.formatExport({ ...baseDraft, thumbnailText: '', tags: [], targetQueries: [] });
    expect(text).toBe('Title: Spring Sale Explained\n\nDescription:\nFull details in this video.\n\nScript:\nFull script here.');
  });
});
