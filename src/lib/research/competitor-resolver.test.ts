import { describe, expect, it } from 'vitest';
import { classifyCompetitor } from './competitor-resolver';

describe('classifyCompetitor', () => {
  it('flags a same-name collision instead of silently merging when domains differ', () => {
    const result = classifyCompetitor(
      { name: 'Acme Bakery', canonicalDomain: 'acme-bakery.test' },
      { name: 'Acme Bakery', canonicalDomain: 'different-acme.test' },
    );
    expect(result.classification).toBe('unknown');
    expect(result.reason).toContain('same name, different domain');
  });

  it('classifies direct when the candidate domain already matches an existing entity', () => {
    const result = classifyCompetitor(
      { name: 'Acme Bakery', canonicalDomain: 'acme-bakery.test' },
      { name: 'Acme Bakery', canonicalDomain: 'acme-bakery.test' },
    );
    expect(result.classification).toBe('direct');
  });

  it('classifies unknown with a plain reason when there is no existing entity to compare against', () => {
    const result = classifyCompetitor({ name: 'New Co', canonicalDomain: 'new-co.test' });
    expect(result.classification).toBe('unknown');
    expect(result.reason).not.toContain('same name, different domain');
  });
});
