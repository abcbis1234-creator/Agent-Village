# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

Please disclose security concerns responsibly. Open an issue in this repository or contact the maintainer directly. Do not post secrets, API keys, credentials, or proof-of-concept exploit code in public issues.

## Security Design

- **Provider-neutral**: no LLM, image, speech, or storage provider is wired in by default. No browser-side API keys or secrets.
- **Server-only seam**: credentials and provider keys never reach the browser.
- **Static file guarding**: `staticFile` in `server.mjs` rejects `..` segments, resolves paths, and verifies the result stays inside `public/` and is a regular file.
- **Security headers**: every response sends `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive `Content-Security-Policy`.
- **Request limits**: request bodies are capped at 20 KB. `POST /api/run` is rate-limited (30 requests per minute per IP) and returns `429` when exceeded.
- **Input validation**: `runTask` validates the request body type and `cleanMission` enforces a non-empty string of at most 1200 characters.
- **Graceful shutdown**: `SIGTERM`/`SIGINT` close the server and exit with a 10-second forced fallback.

## Contributor Rules

- Never introduce shell execution, arbitrary file writes, or unattended automation.
- Never weaken `staticFile` path guards or security headers.
- Keep all provider connectors behind the server boundary.
