# ADR 0001: Phase 1 Tech Stack

**Status:** Accepted
**Date:** 2026-08-14

## Context
Solo founder, 3-week build target for a narrow MVP (one action type, one ICP segment's integration, human-review-only). Full reasoning and options table in `docs/superpowers/specs/2026-08-14-dex-technical-architecture.md`.

## Decision
Next.js 14 (App Router, TypeScript) + Vercel (hosting) + Postgres via Vercel Postgres/Neon + Prisma ORM + Clerk (auth) + OpenAI (LLM).

## Consequences
- Faster solo build than Remix (smaller template/component ecosystem for this founder's existing shadcn/ui conventions) or hand-rolled auth.
- Vendor lock-in to Vercel/Clerk/OpenAI accepted as a Phase 1 tradeoff — none of these are core IP, so migration cost if ever needed is a later problem, not a Phase 1 blocker.
- Superseded when: Phase 2/3 introduce requirements this stack can't serve (e.g. a genuine reason to self-host inference — see the CAIO-advisor breakeven, not expected below 100M+ tokens/month).
