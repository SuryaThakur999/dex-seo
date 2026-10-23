import { describe, it, expect } from 'vitest';
import { ugcBriefAdapter } from './ugc-brief';
import { buildGroundingBlock, type DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: {
    brandVoice: 'Authentic',
    audience: null,
    approvedClaims: [],
    restrictedWording: ['guaranteed results'],
    markets: [],
    languages: [],
  },
  sourceAction: null,
  audience: null,
  objective: null,
  market: null,
  language: null,
};

describe('ugcBriefAdapter', () => {
  it('builds instructions telling the model to copy restricted wording verbatim into doNotSay', () => {
    const instructions = ugcBriefAdapter.buildInstructions();
    expect(instructions).toContain('doNotSay');
    expect(instructions).toContain('verbatim');
  });

  it('folds the topic into the untrusted grounding envelope', () => {
    expect(buildGroundingBlock(input)).toContain('spring sale');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({
      brief: 'Show the product in daily use.',
      deliverables: ['1x 30-second video', '3x photos'],
      doNotSay: ['guaranteed results'],
    });
    expect(ugcBriefAdapter.parseModelOutput(raw)).toEqual({
      brief: 'Show the product in daily use.',
      deliverables: ['1x 30-second video', '3x photos'],
      doNotSay: ['guaranteed results'],
    });
  });

  it('falls back to raw text as brief on invalid JSON', () => {
    expect(ugcBriefAdapter.parseModelOutput('not json')).toEqual({ brief: 'not json', deliverables: [], doNotSay: [] });
  });

  it('flags empty deliverables as invalid, needing assets', () => {
    const result = ugcBriefAdapter.validate({ brief: 'Show the product.', deliverables: [], doNotSay: [] });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('deliverables');
  });

  it('flags an empty brief as invalid', () => {
    const result = ugcBriefAdapter.validate({ brief: '', deliverables: ['1x video'], doNotSay: [] });
    expect(result.valid).toBe(false);
  });

  it('accepts a valid draft', () => {
    const result = ugcBriefAdapter.validate({ brief: 'Show the product.', deliverables: ['1x video'], doNotSay: [] });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('formats export as brief, deliverables list, and do-not-say list', () => {
    const text = ugcBriefAdapter.formatExport({
      brief: 'Show the product in daily use.',
      deliverables: ['1x 30-second video', '3x photos'],
      doNotSay: ['guaranteed results'],
    });
    expect(text).toBe(
      'Brief:\nShow the product in daily use.\n\nDeliverables:\n- 1x 30-second video\n- 3x photos\n\nDo NOT say:\n- guaranteed results'
    );
  });
});
