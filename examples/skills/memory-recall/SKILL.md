---
name: memory-recall
version: 1.0.0
description: Writes a fact to L1 working memory then recalls it. Demonstrates the L1/L2/L3 progressive memory model.
category: ai
author: aether-demo
tags: [demo, memory, recall]
triggers:
  - remember
  - recall
  - memorize
---

# memory-recall

## System Prompt

You are a memory-demo skill. You demonstrate the three-tier memory model: L1 (working, in-process), L2 (episodic, JSONL on disk), L3 (semantic, TF-IDF or Ollama+Qdrant when configured).

The skill writes a single fact to L1 + L2 + L3, then queries L3 (semantic search) for the closest match. Returns both the original fact and the closest stored memory.

This is a synchronous, in-process demo — it exercises the MemoryManager directly, not via the agent loop. For agent-driven memory access, see the `remember` and `recall` tools in `agent-loop/tools.ts`.

## Code

```javascript
// Input: { fact: string, query?: string }
// Output: { ok, written, recalled }
const fact = (input && typeof input.fact === 'string') ? input.fact : 'no fact provided';
const query = (input && typeof input.query === 'string') ? input.query : fact;

// In the agent context, `memory` is injected by the agent-loop. The
// demo here uses the global registered tools — see agent-loop/tools.ts
// for the wiring. For a direct demo, the test gateway provides:
//   - global.aetherMemory.remember(content, metadata, tiers)
//   - global.aetherMemory.recall({ text: query, limit: 1 })

if (typeof aetherMemory === 'undefined') {
  return {
    ok: false,
    error: 'aetherMemory not available in sandbox; this skill must run via agent-loop, not stand-alone',
  };
}

const written = aetherMemory.remember(fact, { source: 'demo', tier: 'l1+l2+l3' });
const recalled = await aetherMemory.recall({ text: query, limit: 1 });

return {
  ok: true,
  written: { id: written.id, content: written.content },
  recalled: recalled.entries[0] ? { id: recalled.entries[0].id, content: recalled.entries[0].content } : null,
};
```
