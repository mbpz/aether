# ADR-010 — Multi-LLM Provider dispatch (Anthropic / Gemini / Bedrock)

- **Status**: Accepted
- **Date**: 2026-07-04
- **Scope**: `packages/gateway/src/llm/provider.ts`, `packages/gateway/src/llm/types.ts`
- **Related**: [ADR-005 SDD 流程](005-sdd-batches.md), [ADR-006 eBPF](006-ebpf-yaml-sync.md)

## Context

v0.1.0–v0.3.x shipped `LLMProvider` with a single implementation
that POSTs to `{baseUrl}/chat/completions` — the OpenAI-compatible
protocol. This works for:

- **OpenAI** (official)
- **Ollama** (OpenAI-compatible local server)
- **OpenRouter** (OpenAI-compatible router)
- **DeepSeek** (OpenAI-compatible)
- **`custom`** (anything else that speaks the OpenAI shape)

It does **not** work for:

- **Anthropic Claude** — uses `/v1/messages`, `x-api-key` header
  (not `Authorization: Bearer`), `anthropic-version: 2023-06-01`
  header, and a different request/response shape (system is a
  top-level field, not a message; `content[]` is a typed array;
  `tool_use` is a separate content block).
- **Google Gemini** — uses `POST /v1beta/models/{model}:generateContent`,
  sends the API key as a query parameter, and uses a `contents[]`
  shape with `parts[]`.
- **AWS Bedrock** — uses the `bedrock-runtime` endpoint with
  **AWS SigV4 signing** (no Bearer token) and a per-region URL.

The v0.3.x single-shape provider limits which LLMs Aether can use.
Users who have Claude / Gemini API keys cannot use Aether without
deploying their own OpenAI-compatible proxy (e.g. LiteLLM).

## Decision

**Add 3 native provider types** alongside the existing OpenAI-compatible
dispatch:

- `type: 'anthropic'` → `POST {baseUrl}/v1/messages` with
  `x-api-key` + `anthropic-version` headers; system messages
  hoisted to a top-level `system` field.
- `type: 'gemini'` → `POST {baseUrl}/models/{model}:generateContent`
  with the API key as `?key=` query parameter; messages translated
  to the `contents[].parts[].text` shape.
- `type: 'bedrock'` → `POST https://bedrock-runtime.{region}.amazonaws.com/model/{model}/invoke`
  with **AWS SigV4** signing (in-tree, ~50 lines of crypto). The
  Anthropic-on-Bedrock body shape is reused (Bedrock InvokeModel
  expects the same JSON).

A single `LLMProvider.chat()` method dispatches by `config.type`:

```ts
switch (this.config.type) {
  case 'openai' | 'ollama' | 'openrouter' | 'custom':
    return this._chatOpenAICompat(messages, opts);
  case 'anthropic':
    return this._chatAnthropic(messages, opts);
  case 'gemini':
    return this._chatGemini(messages, opts);
  case 'bedrock':
    return this._chatBedrock(messages, opts);
}
```

Each branch is a private method that:
1. Builds the provider-specific request body
2. Sets the provider-specific auth headers (or query string)
3. POSTs and parses the response
4. Normalizes into the existing `LLMResponse` shape so the rest of
   the codebase (LLMPlanner, agent loop) is unchanged.

## Why in-tree SigV4 instead of the AWS SDK

The official AWS SDK is ~2 MB installed size and pulls in
`@aws-sdk/*` transitive deps. Aether's LLM layer is currently
zero-dep (uses Node 18+'s built-in `fetch` and `crypto`). Adding
the SDK would re-introduce the dependency surface that v0.2.0
carefully removed. In-tree SigV4 for the specific
`InvokeModel` endpoint is ~50 lines and handles the only Bedrock
scenario Aether needs.

## What is *not* in this batch

- ❌ **Anthropic prompt caching** — Bedrock + Claude support it but
  requires a `cache_control` block in the request body. Deferred
  to a future batch if it becomes a real workload.
- ❌ **Vertex AI** (Google Cloud) — the Gemini API is a subset of
  Vertex AI. Bedrock-style "use the existing Google SDK" applies
  here too. Deferred.
- ❌ **AWS Bedrock agent runtime** — Bedrock has an Agents for
  Bedrock feature, but the LLMProvider abstraction is for raw chat,
  not for managed agents. Aether's own agent loop is the agent.

## Consequences

- ✅ Users with Anthropic / Gemini / Bedrock credentials can now
  configure Aether without a proxy. The 3 new presets in
  `PROVIDER_PRESETS` cover the most common configs.
- ✅ The LLMPlanner + agent loop are unchanged — the normalizers
  map each provider's response back to the existing
  `LLMResponse { choices, message, finish_reason, usage }` shape.
- ✅ Test coverage: 5 new dispatch tests in
  `packages/gateway/src/llm/provider.test.ts` (openai URL,
  anthropic x-api-key + anthropic-version, gemini key-in-query,
  bedrock missing-credentials rejection, unknown-type rejection).
  Total provider tests: 8 → 13.
- ⚠️ The Anthropic + Gemini + Bedrock code paths are only
  exercised against stubbed `fetch`. The shapes were transcribed
  from the official docs; a real-cloud integration test (B9/B15
  candidates) is required before v1.0.
- ⚠️ Bedrock SigV4 implementation supports the specific
  `bedrock-runtime.<region>.amazonaws.com` endpoint and
  Anthropic-on-Bedrock body shape. It does NOT support the
  Converse API (`/converse`) — different request format. Adding
  Converse later is a follow-up.

## Verification

```bash
npm run build                                        # exit 0
npm test                                             # 487 passed, 0 skipped
./node_modules/.bin/vitest run packages/gateway/src/llm/provider.test.ts
                                                    # 13/13 green

grep -c "case 'anthropic'\\|case 'gemini'\\|case 'bedrock'" \
  packages/gateway/src/llm/provider.ts                # 3 (one each)
```
