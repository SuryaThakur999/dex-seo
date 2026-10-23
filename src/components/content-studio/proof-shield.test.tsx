import { describe, it, expect } from 'vitest';
import { ProofShield } from './proof-shield';

function text(el: unknown): string {
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(text).join('');
  if (el && typeof el === 'object') {
    const node = el as { type?: unknown; props?: { children?: unknown } };
    if (typeof node.type === 'function') return text((node.type as (props: unknown) => unknown)(node.props));
    if (node.props) return text(node.props.children);
  }
  return '';
}

describe('ProofShield', () => {
  it('shows an honest not-yet-checked state for null checks', () => {
    expect(text(ProofShield({ checks: null }))).toContain('Not yet checked');
  });

  it('shows an honest not-yet-checked state for an empty array', () => {
    expect(text(ProofShield({ checks: [] }))).toContain('Not yet checked');
  });

  it('summarizes a clean pass without naming any failure', () => {
    const rendered = text(
      ProofShield({
        checks: [
          { check: 'ai-content-disclosure', result: 'pass', detail: 'Disclosure flag attached.' },
          { check: 'length-format', result: 'pass', detail: 'Draft is 90 characters, within range.' },
        ],
      })
    );
    expect(rendered).toContain('All 2 checks passed');
    expect(rendered).toContain('AI disclosure');
    expect(rendered).toContain('Length & format');
  });

  it('summarizes a mix of pass/fail with the real failing detail, and falls back for an unmapped check name', () => {
    const rendered = text(
      ProofShield({
        checks: [
          { check: 'ai-content-disclosure', result: 'pass', detail: 'Disclosure flag attached.' },
          { check: 'no-restricted-wording', result: 'fail', detail: 'Draft contains restricted wording: "guaranteed".' },
          { check: 'some-future-check', result: 'fail', detail: 'A future check detail.' },
        ],
      })
    );
    expect(rendered).toContain('1 of 3 checks passed');
    expect(rendered).toContain('need your review');
    expect(rendered).toContain('guaranteed');
    expect(rendered).toContain('some-future-check');
  });
});
