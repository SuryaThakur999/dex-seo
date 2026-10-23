import { describe, it, expect } from 'vitest';
import { CHECK_ICON, CHECK_LABEL } from './guard-outcome-ui';

// This list is not imported from proof-layer.ts because that file doesn't export
// its check names as a collection (each is a string literal inside its own check
// function). Keep this list in sync by hand — if a check is renamed or a sixth
// check is added there without a matching update here, this test is what catches
// the missing icon/label instead of the review page silently rendering `undefined`.
const PROOF_LAYER_CHECK_NAMES = [
  'ai-content-disclosure',
  'no-unverifiable-claims',
  'no-contradiction',
  'length-format',
  'duplicate-risk',
];

describe('CHECK_ICON and CHECK_LABEL', () => {
  it('has an icon and a label for every real ProofLayer check name', () => {
    for (const name of PROOF_LAYER_CHECK_NAMES) {
      expect(CHECK_ICON[name]).toBeDefined();
      expect(CHECK_LABEL[name]).toBeDefined();
    }
  });

  it('has exactly the same keys in both maps', () => {
    expect(Object.keys(CHECK_ICON).sort()).toEqual(Object.keys(CHECK_LABEL).sort());
  });
});
