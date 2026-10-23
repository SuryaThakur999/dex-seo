import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('prisma/schema.prisma', 'utf8');

describe('ProfileSuggestion storage contract', () => {
  it('binds the website to the same client profile at the database boundary', () => {
    const model = schema.match(/model ProfileSuggestion \{([\s\S]*?)\n\}/)?.[1];
    expect(model).toBeDefined();
    expect(model).toContain('fields: [websiteId, clientProfileId], references: [id, clientProfileId]');
    expect(schema.match(/model Website \{([\s\S]*?)\n\}/)?.[1]).toContain('@@unique([id, clientProfileId])');
  });

  it('stores decisions separately from evidence identity', () => {
    const model = schema.match(/model ProfileSuggestion \{([\s\S]*?)\n\}/)?.[1];
    expect(model).toMatch(/identity\s+String\s+@unique/);
    expect(model).toMatch(/status\s+ProfileSuggestionStatus\s+@default\(suggested\)/);
    for (const field of ['sourceUrl', 'sourceExcerpt', 'modelVersion', 'promptVersion', 'decidedAt']) {
      expect(model).toContain(field);
    }
  });

  it('does not allow suggestions to approve claims or change restrictions', () => {
    const fields = schema.match(/enum ProfileSuggestionField \{([\s\S]*?)\n\}/)?.[1]?.trim().split(/\s+/);
    expect(fields).toEqual(['businessDescription', 'audience', 'markets', 'languages', 'brandVoice', 'socialProfiles']);
    expect(fields).not.toContain('approvedClaims');
    expect(fields).not.toContain('restrictedWording');
  });
});
