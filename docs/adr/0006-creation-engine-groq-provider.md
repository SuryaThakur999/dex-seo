# ADR 0006: Creation Engine LLM Provider Switched to Groq (gpt-oss-120b)

**Status:** Accepted
**Date:** 2026-08-22

## Context
ADR 0001 named OpenAI as the Phase 1 LLM provider. At the point of getting the dashboard production-ready for real end-to-end testing, no OpenAI API key was available, but a Groq API key already in use on another project was on hand. Groq's API is OpenAI-SDK-compatible (same request/response shape via `baseURL: https://api.groq.com/openai/v1`), and hosts `openai/gpt-oss-120b`, OpenAI's own open-weight model, alongside faster/cheaper inference than `gpt-4o-mini`.

## Decision
`creation-engine.ts` now reads an optional `OPENAI_BASE_URL` env var (unset = OpenAI's real endpoint, set to Groq's endpoint = Groq) and uses `openai/gpt-oss-120b` instead of `gpt-4o-mini`. The env var name `OPENAI_API_KEY` is kept as-is (holds the Groq key when `OPENAI_BASE_URL` points at Groq) to avoid a second secret-naming convention.

## Consequences
- Draft generation runs in a background cron job (`/api/scan/process`), not synchronously in front of a waiting user, so Groq's latency advantage isn't the deciding factor here; its cost and the fact that a working key was already available were.
- gpt-oss-120b is OpenAI's own model lineage, so grounded short-copy quality (meta descriptions, titles) is expected to be comparable to gpt-4o-mini, not a downgrade, but this is unverified against real customer output at time of writing.
- Reverting to OpenAI directly is a one-line change (unset `OPENAI_BASE_URL`, supply a real `OPENAI_API_KEY`, swap `MODEL` back) since the call shape is identical.
- Superseded when: real draft quality data from actual customers shows gpt-oss-120b via Groq underperforms gpt-4o-mini for this task, or a production OpenAI key becomes available and there's reason to prefer it.
