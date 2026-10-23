import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateAndValidateContentPiece } from './generate-and-validate';
import { db } from '@/lib/db';
import { getAdapter } from './registry';
import { generateContentDraft } from './draft-generator';
import { xAdapter } from './adapters/x';
import { ContentGenerationError } from './generation-error';

vi.mock('@/lib/db', () => ({
  db: { contentPiece: { findMany: vi.fn(() => []) } },
}));
vi.mock('./registry', () => ({ getAdapter: vi.fn() }));
vi.mock('./draft-generator', () => ({ generateContentDraft: vi.fn() }));

const clientProfile = {
  id: 'profile_1',
  brandVoice: 'Warm',
  audience: 'SMBs',
  approvedClaims: [],
  restrictedWording: [],
  markets: [],
  languages: [],
};

const baseInput = {
  clientProfile,
  websiteId: 'site_1',
  platform: 'linkedin' as const,
  topic: 'spring sale',
  sourceAction: null,
  audience: null,
  objective: null,
  market: null,
  language: null,
};

describe('generateAndValidateContentPiece', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.contentPiece.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it.each(['validation', 'history', 'export'])('retains measured usage when %s fails after generation', async (stage) => {
    const cause = new Error(`${stage} failed`);
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
      validate: () => {
        if (stage === 'validation') throw cause;
        return { valid: true, issues: [] };
      },
      formatExport: () => { throw cause; },
    });
    (generateContentDraft as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { body: 'Approved copy' }, tokenCost: 37,
    });
    if (stage === 'history') {
      (db.contentPiece.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(cause);
    }

    await expect(generateAndValidateContentPiece(baseInput)).rejects.toMatchObject({
      name: ContentGenerationError.name, tokenCost: 37, cause,
    });
  });

  it('resolves audience/objective/market/language into the DraftPromptInput passed to generation', async () => {
    const adapter = {
      platform: 'linkedin',
      buildInstructions: () => 'PROMPT',
      validate: () => ({ valid: true, issues: [] }),
      formatExport: (d: { body: string }) => d.body,
    };
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
    (generateContentDraft as ReturnType<typeof vi.fn>).mockResolvedValue({ draft: { body: 'copy' }, tokenCost: 10 });

    await generateAndValidateContentPiece({
      ...baseInput,
      audience: 'Enterprise CFOs',
      objective: 'Thought leadership',
      market: 'DE',
      language: 'German',
    });

    expect(generateContentDraft).toHaveBeenCalledWith(
      adapter,
      expect.objectContaining({ audience: 'Enterprise CFOs', objective: 'Thought leadership', market: 'DE', language: 'German' })
    );
  });

  it.each([0, 1, 2] as const)('forwards variant angle %s to generation', async (angleIndex) => {
    const adapter = {
      ...xAdapter,
      validate: () => ({ valid: false, issues: ['Missing assets.'] }),
    };
    vi.mocked(getAdapter).mockReturnValue(adapter);
    vi.mocked(generateContentDraft).mockResolvedValue({ draft: { body: 'copy' }, tokenCost: 10 });

    await generateAndValidateContentPiece({ ...baseInput, angleIndex });

    expect(generateContentDraft).toHaveBeenCalledWith(
      adapter, expect.objectContaining({ topic: baseInput.topic }), undefined, angleIndex,
    );
  });

  it('records the real proof checks (including a clean pass) when validation succeeds', async () => {
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
      platform: 'linkedin',
      buildInstructions: () => 'PROMPT',
      validate: () => ({ valid: true, issues: [] }),
      formatExport: (d: { body: string }) => d.body,
    });
    (generateContentDraft as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { body: 'A clean, honest post about our real approved facts.' },
      tokenCost: 10,
    });

    const result = await generateAndValidateContentPiece(baseInput);

    expect(result.status).toBe('draft');
    expect(db.contentPiece.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clientProfileId: 'profile_1', websiteId: 'site_1', platform: 'linkedin' },
    }));
    expect(result.proofChecks).not.toBeNull();
    expect(result.proofChecks!.length).toBeGreaterThan(0);
  });

  it('skips the proof layer (proofChecks null) when the draft fails format validation', async () => {
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
      platform: 'instagram',
      buildInstructions: () => 'PROMPT',
      validate: () => ({ valid: false, issues: ['Missing alt text.'] }),
      formatExport: () => '',
    });
    (generateContentDraft as ReturnType<typeof vi.fn>).mockResolvedValue({ draft: { caption: 'x' }, tokenCost: 5 });

    const result = await generateAndValidateContentPiece({ ...baseInput, platform: 'instagram' });

    expect(result.status).toBe('needs_assets');
    expect(result.proofChecks).toBeNull();
  });

  it('tolerates a malformed historical draftContent in recentDraftTexts without failing the current generation', async () => {
    // Real production bug (previously covered at the drafts route level, moved here because the
    // defensive flatMap try/catch it protects lives in this function, not the route): a prior
    // failed generation persists draftContent as {}, and a real adapter's formatExport (e.g.
    // reading draft.hashtags.map(...)) throws on that shape. One malformed historical row must
    // never crash an otherwise-successful current generation.
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
      platform: 'linkedin',
      buildInstructions: () => 'PROMPT',
      validate: () => ({ valid: true, issues: [] }),
      formatExport: (d: { body?: string }) => {
        if (!d || typeof d.body !== 'string') throw new TypeError("Cannot read properties of undefined (reading 'body')");
        return d.body;
      },
    });
    (generateContentDraft as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { body: 'Spring sale copy.' }, tokenCost: 50,
    });
    (db.contentPiece.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { draftContent: {} },
      { draftContent: { body: 'Earlier real post.' } },
    ]);

    const result = await generateAndValidateContentPiece(baseInput);

    expect(result.status).toBe('draft');
  });

  it('checks restricted wording in later X thread posts and retains generation usage', async () => {
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue(xAdapter);
    (generateContentDraft as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { body: 'An honest opening.', posts: ['An honest opening.', 'Guaranteed results.'], hashtags: [] },
      tokenCost: 37,
    });

    const result = await generateAndValidateContentPiece({
      ...baseInput,
      platform: 'x',
      clientProfile: { ...clientProfile, restrictedWording: ['guaranteed'] },
    });

    expect(result.status).toBe('needs_review');
    expect(result.tokenCost).toBe(37);
    expect(result.proofChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'no-restricted-wording', result: 'fail' }),
    ]));
  });
});
