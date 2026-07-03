# @aether/gateway — Zero-Trust Control Plane

> Multi-provider LLM dispatch + Manifest-gated sandbox + Agent loop.
> Composes `@aether/sandbox` and `@aether/skill-loader`.

## Standalone usage

```typescript
import { LLMProvider } from '@aether/gateway/llm';

// one config, any LLM. Switch by changing type + baseUrl.
const llm = new LLMProvider({
  type: 'ollama',                      // 'openai' | 'anthropic' | 'gemini' | 'bedrock' | 'ollama' | 'openrouter' | 'custom'
  baseUrl: 'http://localhost:11434',
  model: 'deepseek-r1',
  apiKey: process.env.LLM_API_KEY,     // not needed for local Ollama
});

const response = await llm.chat([
  { role: 'user', content: 'Write a CSV parser in JS' },
]);
console.log(response.choices[0].message.content);
```

## Provider presets

```typescript
// Claude
new LLMProvider({ type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-7', apiKey: 'sk-ant-...' });

// Gemini
new LLMProvider({ type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-pro', apiKey: '...' });

// Bedrock (in-tree SigV4, ~50 lines, zero AWS SDK dependency)
new LLMProvider({ type: 'bedrock', region: 'us-east-1', model: 'anthropic.claude-sonnet-4-7', apiKey: '...', apiSecret: '...' });
```

## With Manifest-gated sandbox execution

```typescript
import { SandboxBridge, ManifestEngine, AuditLogger } from '@aether/gateway/sandbox';

const bridge = new SandboxBridge(
  taskQueue, new AuditLogger(), new ManifestEngine(),
);

const result = await bridge.execute({
  code: 'console.log(42)',
  manifestName: 'default',  // reads manifest from ./manifests/
});

console.log(result.ok, result.output);
```

## HTTP Gateway server

For the full HTTP + WebSocket gateway (agent routes, skill routes, audit, multi-agent):

```bash
npm run dev -w packages/gateway
# or programmatically:
```

```typescript
import { createGatewayServer } from '@aether/gateway/server';
// See packages/gateway/src/index.ts for the full wiring example.
```

## Composition

```
@gateway ─────> @aether/sandbox   (V8 Isolate + SecurityPolicy)
   │
   └──────────> @aether/skill-loader (3-tier disclosure + format converter)
```

`@aether/gateway` is the **orchestrator**: it wires LLM dispatch, skill loading,
sandbox execution, and (optionally) multi-agent collaboration into one HTTP API.
You can use each piece independently — `@aether/skill-loader` without the gateway,
`@aether/sandbox` without a provider, etc.

## API surface (subpath exports)

| Import path | What you get |
|---|---|
| `@aether/gateway/server` | `createGatewayServer(deps)` — full HTTP + WS |
| `@aether/gateway/sandbox` | `SandboxBridge`, `TaskQueue` |
| `@aether/gateway/manifest` | `ManifestEngine`, `PermissionManifest` |
| `@aether/gateway/llm` | `LLMProvider`, `LLMError`, `LLMProviderConfig` |
| `@aether/gateway/memory` | `MemoryManager` |
| `@aether/gateway/audit` | `AuditLogger` |
