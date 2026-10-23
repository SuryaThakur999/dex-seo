import { describe, it, expect } from 'vitest';
import { tiktokAdapter } from './tiktok';
import { buildGroundingBlock, type DraftPromptInput } from '../adapter-types';
import { CONTENT_STRUCTURES } from '../playbook-shared';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Fast, fun', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
  audience: null,
  objective: null,
  market: null,
  language: null,
};

describe('tiktokAdapter', () => {
  it('builds instructions describing the hook as the first-2-seconds line, with structure and CTA guidance', () => {
    const instructions = tiktokAdapter.buildInstructions();
    expect(instructions).toContain('first 2 seconds');
    expect(instructions).toContain('PAS');
    expect(instructions).toContain('contrarian');
  });

  it('folds the topic into the untrusted grounding envelope', () => {
    expect(buildGroundingBlock(input)).toContain('spring sale');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({
      hook: 'Wait for it...',
      script: 'Full script here.',
      structure: 'contrarian',
      cta: 'Follow for more.',
      captionText: 'Spring sale',
      hashtags: ['sale'],
    });
    expect(tiktokAdapter.parseModelOutput(raw)).toEqual({
      hook: 'Wait for it...',
      script: 'Full script here.',
      structure: 'contrarian',
      cta: 'Follow for more.',
      captionText: 'Spring sale',
      hashtags: ['sale'],
    });
  });

  it('falls back to raw text as script on invalid JSON', () => {
    expect(tiktokAdapter.parseModelOutput('not json')).toEqual({
      hook: '',
      script: 'not json',
      structure: '',
      cta: '',
      captionText: '',
      hashtags: [],
    });
  });

  it('flags an empty hook as invalid', () => {
    const result = tiktokAdapter.validate({
      hook: '',
      script: 'Full script.',
      structure: 'PAS',
      cta: 'Follow for more.',
      captionText: 'Sale',
      hashtags: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('hook'))).toBe(true);
  });

  it('flags an empty script as invalid', () => {
    const result = tiktokAdapter.validate({
      hook: 'Wait for it...',
      script: '',
      structure: 'PAS',
      cta: 'Follow for more.',
      captionText: 'Sale',
      hashtags: [],
    });
    expect(result.valid).toBe(false);
  });

  it('flags a banned AI-filler phrase in the script', () => {
    const result = tiktokAdapter.validate({
      hook: 'This is a game-changer.',
      script: 'This is a game-changer.',
      structure: 'PAS',
      cta: 'Follow for more.',
      captionText: 'Sale',
      hashtags: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('banned AI-filler'))).toBe(true);
  });

  it('accepts a valid draft with hook, structure, and CTA present', () => {
    const result = tiktokAdapter.validate({
      hook: 'Wait for it...',
      script: 'Full script.',
      structure: 'PAS',
      cta: 'Follow for more.',
      captionText: 'Sale',
      hashtags: [],
    });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('golden: each of the three structures produces a valid draft with hook, structure, and CTA', () => {
    for (const structure of CONTENT_STRUCTURES) {
      const result = tiktokAdapter.validate({
        hook: `Opening line for ${structure}.`,
        script: `Opening line for ${structure}. Rest of the script.`,
        structure,
        cta: 'Follow for more.',
        captionText: 'Sale',
        hashtags: [],
      });
      expect(result.valid).toBe(true);
    }
  });

  it('formats export as hook, script, and caption with hashtags', () => {
    const text = tiktokAdapter.formatExport({
      hook: 'Wait for it...',
      script: 'Full script.',
      structure: 'PAS',
      cta: 'Follow for more.',
      captionText: 'Spring sale',
      hashtags: ['sale'],
    });
    expect(text).toBe('Hook (first 2 seconds): Wait for it...\n\nScript:\nFull script.\n\nCaption: Spring sale #sale');
  });
});
