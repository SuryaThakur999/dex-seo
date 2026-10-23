import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Phase 1E, Part E #1: a deterministic architecture test, not a custom ESLint plugin (the
// directive's own preference -- "a clear repository test" is more auditable and needs no new
// tooling). The real invariant: every production file that talks to the model provider goes
// through getOpenAIClient() in openai-client.ts, which is what centralizes maxRetries, timeout,
// and (per that file's own comment) the exact (provider, model) pair Phase 1C's circuit breaker
// keys on. A second file constructing `new OpenAI(...)` directly would silently bypass all of
// that. Test files legitimately import `openai`'s error classes (RateLimitError etc.) to build
// realistic fixtures -- excluded here, since they never construct a live client.

const SRC_ROOT = join(__dirname, '..', '..');
const ALLOWLIST = new Set(['src/lib/openai-client.ts']);
// Matches static `from 'openai'`, `require('openai')`, and dynamic `import('openai')` -- plus
// any subpath (`'openai/error'`, `'openai/resources/...'`) for all three forms, since a file
// bypassing openai-client.ts via a subpath import still evades the centralization this guard
// exists to enforce. Independent review (2026-09-30) flagged the original pattern's dynamic-
// import and subpath blind spot.
const IMPORT_PATTERN =
  /from\s+['"]openai(?:\/[^'"]*)?['"]|require\(\s*['"]openai(?:\/[^'"]*)?['"]\s*\)|import\(\s*['"]openai(?:\/[^'"]*)?['"]\s*\)/;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe('provider import guard', () => {
  it('only src/lib/openai-client.ts imports the `openai` package directly', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const relPath = relative(join(SRC_ROOT, '..'), file).split('\\').join('/');
      if (ALLOWLIST.has(relPath)) continue;
      const content = readFileSync(file, 'utf-8');
      if (IMPORT_PATTERN.test(content)) offenders.push(relPath);
    }
    expect(offenders, `Files importing 'openai' directly outside the allowlist: ${offenders.join(', ')}`).toEqual([]);
  });
});
