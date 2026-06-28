---
slug: /reference/llm
title: LLM Providers
sidebar_label: LLM Providers
---

# LLM Provider Reference

Aether's `LLMProvider` class wraps any OpenAI-compatible HTTP
endpoint. Supported providers (verified in CI):

| Provider | Config |
|----------|--------|
| **OpenAI** | `LLM_BASE_URL=https://api.openai.com/v1`, `LLM_MODEL=gpt-4o`, `LLM_API_KEY=sk-...` |
| **Ollama (local)** | `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=deepseek-r1` (no API key needed) |
| **vLLM (self-hosted)** | `LLM_BASE_URL=http://your-vllm-host:8000/v1` |
| **OpenRouter** | `LLM_BASE_URL=https://openrouter.ai/api/v1`, `LLM_MODEL=anthropic/claude-3-haiku`, `LLM_API_KEY=sk-or-...` |
| **DeepSeek** | `LLM_BASE_URL=https://api.deepseek.com/v1`, `LLM_MODEL=deepseek-chat` |

If `LLM_BASE_URL` is empty, the gateway uses the built-in
`MockPlanner` which keyword-matches against tool rules (no actual
LLM call). See
[`packages/gateway/src/agent-loop/planner.ts`](https://github.com/aether/aether/blob/main/packages/gateway/src/agent-loop/planner.ts)
for the keyword table.

## Fail-closed on LLM error

`LLMProvider.chat()` throws `LLMError` on:

- `fetch()` rejects (network down)
- Non-2xx HTTP response
- Empty `choices[]` in the response body
- API-reported `error` field

The gateway converts this to:
- `AgentLoop.run()` returns `ok: false, error: 'API down'`
- The session record is persisted with `ok: false`
- The audit log gets a `failure` entry

There is **no retry** — LLM errors are caller-recoverable (the agent
loop's caller should retry or fall back to MockPlanner if the LLM
flapping is intolerable).

## Programmatic usage

```typescript
import { LLMProvider, LLMError } from '@aether/gateway/llm';

const provider = new LLMProvider({
  type: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o',
  temperature: 0.2,
  maxTokens: 2048,
  timeoutMs: 30_000,
});

try {
  const r = await provider.chat([
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ]);
  console.log(r.choices[0].message.content);
} catch (err) {
  if (err instanceof LLMError) {
    console.error(`LLM failure: ${err.message}`);
  } else {
    throw err;
  }
}
```

## Tests

- `packages/gateway/src/llm/manager.test.ts` — 8 tests
- `packages/gateway/src/llm/provider.test.ts` — 8 tests
- `packages/gateway/src/llm/planner.test.ts` — 6 tests (LLMPlanner with stubbed provider)
