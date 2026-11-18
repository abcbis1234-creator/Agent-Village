# Free-first multi-model setup

Agent Village supports a local Ollama model plus optional hosted providers. The local provider makes requests to your own machine and does not require an API key or per-token API billing. You still need to download a model, storage space, and hardware capable of running it.

## Free-first default: Ollama

1. Install Ollama from https://ollama.com/download.
2. Start Ollama and download a model, for example: `ollama pull llama3.2`.
3. Start Agent Village on the same computer. The default endpoint is `http://127.0.0.1:11434/api/chat`.
4. Optional: set `OLLAMA_MODEL` to the exact model tag you downloaded or `OLLAMA_HOST` to your local Ollama API endpoint.

The default local model name is a starting example; choose a model that fits your computer's memory and performance. No hosted provider is called automatically.

## Optional hosted providers

- OpenAI / ChatGPT API: `OPENAI_API_KEY`, optional `OPENAI_MODEL`
- Anthropic / Claude API: `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`
- Google Gemini API: `GEMINI_API_KEY`, optional `GEMINI_MODEL`

For hosted providers, set a model ID currently supported by that provider. The gateway deliberately does not guess a default model ID. Consumer ChatGPT, Claude, and Gemini free chat plans do not automatically provide API access or API credits. Check each provider's current free-tier availability, limits, and billing before enabling it.

## API and security

- `GET /api/models/providers` reports provider availability and model selection without returning credentials.
- `POST /api/models/generate` body: `{"provider":"ollama","prompt":"...","system":"..." }`
- `POST /api/models/compare` body: `{"providers":["ollama","gemini"],"prompt":"...","system":"..." }`
- Generation endpoints require `MODEL_GATE_TOKEN` and an `x-model-token` header. Set a long random token in the server environment.

Hosted calls happen only when explicitly selected and configured. Comparison runs only the selected providers, concurrently, and may incur charges for hosted providers. There is no automatic paid fallback. API keys remain server-side.

## Current boundaries

This is a provider gateway, not a fully autonomous team of independent agents. The local and hosted models generate responses when explicitly called; the existing five village roles remain local demo roles until their orchestration is connected to this gateway. Before public deployment, add user authentication, per-user quotas, durable audit logs, and network restrictions for the local Ollama endpoint.
