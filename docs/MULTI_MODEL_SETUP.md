# Multi-model provider setup

Agent Village includes an optional server-side model gateway for OpenAI, Anthropic Claude, and Google Gemini. Provider calls are explicit user actions; the app does not silently fall back to a paid provider.

## Environment

Set only the providers you want to use on the server:

- `OPENAI_API_KEY` and optional `OPENAI_MODEL`
- `ANTHROPIC_API_KEY` and optional `ANTHROPIC_MODEL`
- `GEMINI_API_KEY` and optional `GEMINI_MODEL`
- `MODEL_GATE_TOKEN` (required to enable generation endpoints)

Defaults are configurable in `studio/model-gateway.mjs`. API credentials must never be placed in browser JavaScript, HTML, commits, or screenshots. Hosted API usage can be billed separately from consumer chat subscriptions. Check each provider's current billing and rate limits before enabling it.

## API

- `GET /api/models/providers` returns provider names, selected model IDs, and whether a key is configured. It never returns keys.
- `POST /api/models/generate` body: `{"provider":"openai","prompt":"...","system":"..." }`
- `POST /api/models/compare` body: `{"providers":["openai","anthropic","gemini"],"prompt":"...","system":"..." }`

Generation and comparison require the `x-model-token` header to match `MODEL_GATE_TOKEN`. Requests are bounded by prompt length and timeout. Comparison runs only the providers explicitly selected in that request; each may incur API charges.

## Current limits

This is a provider gateway, not autonomous multi-agent learning. It does not grant ChatGPT subscription access, browser access, or free API credits. It does not persist prompts or model responses. Add application authentication, per-user quotas, durable audit records, and deployment-specific secret management before exposing the server publicly.
