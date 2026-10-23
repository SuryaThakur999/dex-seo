import { defineConfig, defaultExclude } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // tsconfig's "jsx": "preserve" is for Next.js's own SWC pipeline; esbuild falls back to
  // classic JSX transform (requiring a React identifier in scope) unless told otherwise,
  // which breaks any .tsx file that doesn't happen to `import React` -- most of this
  // codebase doesn't, since Next's real build uses the automatic runtime. Match that here.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    setupFiles: ['./src/test/setup.ts'],
    // superpowers:using-git-worktrees creates worktrees under .worktrees/ for
    // parallel plan execution — each one carries its own full copy of the
    // test suite, which vitest's default discovery would otherwise also run.
    // .claude/worktrees/ is the same pattern under a different root (used by
    // ecc-style slice worktrees) and was missing here, silently doubling the
    // reported test count. Extend, not replace, vitest's own defaults.
    exclude: [...defaultExclude, '**/.worktrees/**', '**/.claude/worktrees/**'],
  },
});
