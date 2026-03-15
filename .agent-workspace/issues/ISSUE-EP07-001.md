# ISSUE-EP07-001

**状态**：Open  
**优先级**：P2（代码质量 / 维护性）  
**发现时间**：2026-03-14 23:38  
**发现者**：QA Agent（EP-07 静态代码审查）

---

## 问题描述

在 `packages/gateway/src/routes/llm.ts` 的 `POST /run` 路由（第 123 行），使用 `(agentRunner as any).registry` 通过 `any` 类型强制访问 `AgentRunner` 的私有成员 `registry`：

```typescript
// routes/llm.ts L121-L125
const registry = (agentRunner as any).registry;
const planner = new LLMPlanner(llmManager.provider!, registry);
const plannerResult = await planner.plan(String(task));
```

---

## 潜在风险

1. **编译期不可见**：TypeScript 不会校验 `any` 类型的属性访问，重构时若 `AgentRunner.registry` 改名/删除，编译不报错，但运行时 `registry` 为 `undefined`
2. **运行时崩溃路径**：`LLMPlanner` 构造后，`plan()` 调用 `this.registry.list()`，若 `registry` 为 undefined，抛出 `TypeError: Cannot read properties of undefined (reading 'list')`，路由 catch 会返回 500 但错误信息不友好
3. **违反封装原则**：绕过了 TypeScript 的访问控制，增加模块间耦合

---

## 复现条件

- 当前不会复现（`AgentRunner.registry` 属性存在且名称正确）
- 未来对 `AgentRunner` 重构时存在风险

---

## 建议修复方案

**方案 A（推荐）**：在 `AgentRunner` 中暴露 getter
```typescript
// agent-loop/runner.ts
get toolRegistry(): ToolRegistry {
  return this.registry;
}
```
然后路由中：
```typescript
const registry = agentRunner.toolRegistry;
```

**方案 B**：将 `ToolRegistry` 作为独立依赖注入路由
```typescript
// routes/llm.ts
interface LLMRouterDeps {
  llmManager: LLMManager;
  agentRunner: AgentRunner;
  toolRegistry: ToolRegistry;  // 新增
}
```

**方案 C**：添加运行时防护
```typescript
const registry = (agentRunner as any).registry;
if (!registry) {
  res.status(500).json({ error: 'Internal error: tool registry unavailable' });
  return;
}
```

---

## 影响范围

- `packages/gateway/src/routes/llm.ts`
- 可能涉及 `packages/gateway/src/agent-loop/runner.ts`
