import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { MODEL_OPERATIONS } from './operation-registry';

// Phase 1E, Part E #2. Independent review (2026-09-30) flagged the first version of this test:
// it compared MODEL_OPERATIONS against a hand-typed duplicate list, so it could only ever prove
// the two lists agree with each other, not that either reflects the real codebase -- a future PR
// adding a fifth real getOpenAIClient() call site could silently skip both lists forever. This
// version instead walks src/lib for every real call site (the same `getOpenAIClient(` signal
// Part A's own inventory used) and fails, naming the file, if one isn't mapped to a registered
// operation -- the mapping below is still hand-maintained (a file path doesn't mechanically imply
// an operationName), but the SET of files it must cover is discovered live, not copied.
const SRC_LIB_ROOT = path.join(__dirname, '..');

function findGetOpenAIClientCallers(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === '__fixtures__') continue;
      found.push(...findGetOpenAIClientCallers(fullPath));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry === 'openai-client.ts') continue;
    const content = readFileSync(fullPath, 'utf-8');
    if (/getOpenAIClient\(/.test(content)) {
      found.push(path.relative(SRC_LIB_ROOT, fullPath));
    }
  }
  return found;
}

// One entry per real call site findGetOpenAIClientCallers can discover today. Adding a new file
// that calls getOpenAIClient() without adding it here is exactly the drift this test exists to
// catch -- the "site not covered" assertion below fails with the discovered path, not silently.
const FILE_TO_OPERATION: Record<string, string> = {
  'creation-engine.ts': 'meta_description',
  'restricted-wording-fix.ts': 'restricted_wording_fix',
  'internal-link-fix.ts': 'internal_link_fix',
  'content-studio/draft-generator.ts': 'content_studio_draft',
  'feedback-analysis.ts': 'feedback_pattern_summary',
  'preference-candidates.ts': 'preference_candidate_proposal',
  'dashboard-insight.ts': 'dashboard_insight',
  'profile-suggestion-extractor.ts': 'profile_suggestion_extraction',
};

describe('MODEL_OPERATIONS registry', () => {
  it('covers every real getOpenAIClient() call site discovered under src/lib', () => {
    const discovered = findGetOpenAIClientCallers(SRC_LIB_ROOT);
    expect(discovered.length).toBeGreaterThan(0); // the scan itself must find something real, or this test is vacuous

    const registeredNames = new Set(MODEL_OPERATIONS.map((op) => op.operationName));
    for (const file of discovered) {
      const operationName = FILE_TO_OPERATION[file];
      expect(operationName, `${file} calls getOpenAIClient() but is not mapped in FILE_TO_OPERATION`).toBeDefined();
      expect(registeredNames.has(operationName!), `${file} maps to '${operationName}', which is not in MODEL_OPERATIONS`).toBe(true);
    }

    // The inverse direction: no stale registry entry for a file that no longer calls
    // getOpenAIClient() (deleted, refactored, or moved without updating this map).
    const mappedFiles = Object.keys(FILE_TO_OPERATION);
    const discoveredSet = new Set(discovered);
    for (const file of mappedFiles) {
      expect(discoveredSet.has(file), `FILE_TO_OPERATION maps ${file}, but it no longer calls getOpenAIClient()`).toBe(true);
    }
  });

  it('gives no operation tool-calling or publishing authority', () => {
    for (const op of MODEL_OPERATIONS) {
      expect(op.toolsAllowed, `${op.operationName} must have toolsAllowed: false`).toBe(false);
    }
  });

  it('declares a real prompt version, boundary version, and non-zero size bounds for every operation', () => {
    for (const op of MODEL_OPERATIONS) {
      expect(op.promptVersion, op.operationName).toMatch(/^v\d+$/);
      expect(op.boundaryVersion, op.operationName).toMatch(/^v\d+$/);
      expect(op.maxInputChars, op.operationName).toBeGreaterThan(0);
      expect(op.maxOutputChars, op.operationName).toBeGreaterThan(0);
    }
  });
});
