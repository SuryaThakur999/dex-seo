import { describe, it, expect } from 'vitest';
import { computeDiff } from './diff';

describe('computeDiff', () => {
  it('returns a single equal segment for identical text', () => {
    expect(computeDiff('Fresh coffee, roasted daily.', 'Fresh coffee, roasted daily.')).toEqual([
      { type: 'equal', value: 'Fresh coffee, roasted daily.' },
    ]);
  });

  it('marks pure addition at the end as added', () => {
    const result = computeDiff('Fresh coffee.', 'Fresh coffee. Free shipping.');
    expect(result).toEqual([
      { type: 'equal', value: 'Fresh coffee.' },
      { type: 'added', value: ' Free shipping.' },
    ]);
  });

  it('marks pure removal as removed', () => {
    const result = computeDiff('Fresh coffee. Free shipping.', 'Fresh coffee.');
    expect(result).toEqual([
      { type: 'equal', value: 'Fresh coffee.' },
      { type: 'removed', value: ' Free shipping.' },
    ]);
  });

  it('marks a middle word replacement as removed then added', () => {
    const result = computeDiff('Buy cheap coffee online', 'Buy premium coffee online');
    expect(result).toEqual([
      { type: 'equal', value: 'Buy ' },
      { type: 'removed', value: 'cheap' },
      { type: 'added', value: 'premium' },
      { type: 'equal', value: ' coffee online' },
    ]);
  });

  it('treats an empty old value as all-added', () => {
    expect(computeDiff('', 'Brand new description.')).toEqual([
      { type: 'added', value: 'Brand new description.' },
    ]);
  });

  it('treats an empty new value as all-removed', () => {
    expect(computeDiff('Old description.', '')).toEqual([
      { type: 'removed', value: 'Old description.' },
    ]);
  });
});
