# Multi-Agent Enhancement Design

**Date:** 2026-05-10
**Status:** Approved

## 1. Overview

Enhance EP-05 multi-agent system with three improvements:
1. Smart task splitting based on agent capabilities
2. Enhanced communication reliability (retry/reconnect/DLQ)
3. Complete hierarchical mode with dependency tracking

## 2. Component Architecture

### 2.1 TaskAnalyzer

Replaces uniform `_splitTask()` in `TeamOrchestrator`. Analyzes task description and assigns subtasks based on agent capabilities.

```typescript
// packages/gateway/src/multi-agent/task-analyzer.ts

export interface CapabilityMatch {
  agentId: string;
  role: TeamRole;
  matchScore: number;  // 0-100
  reasoning: string;
}

export class TaskAnalyzer {
  /**
   * Analyze task and return capability-matched assignments.
   * Returns array of { agentId, taskDescription, reasoning }
   */
  analyze(task: string, members: TeamMember[]): CapabilityMatch[];
}
```

**Splitting strategy:**
- If task contains keywords matching agent capabilities → assign to best-fit agent
- If no capability match → use round-robin with fallback to uniform split
- Hierarchical mode: planner gets the full task, executors get semantic sub-parts

### 2.2 ReliableBus (MessageBus wrapper)

Wraps existing `MessageBus` with reliability features.

```typescript
// packages/gateway/src/multi-agent/reliable-bus.ts

export class ReliableMessageBus {
  constructor(private bus: MessageBus, config?: ReliableConfig);

  // Inherited publish/consume from bus
  publish(msg: BusMessage): { success: boolean; retryCount: number };
  consume(recipient: string, limit: number): BusMessage[];

  // New reliability methods
  getConnectionState(): ConnectionState;
  reconnect(): Promise<void>;
  getDeadLetterQueue(): DeadLetterEntry[];
}
```

**Reliability features:**
- Retry with exponential backoff (3 retries, 1s/2s/4s)
- Connection state tracking (connected/reconnecting/disconnected)
- Dead letter queue for messages that failed after all retries
- Automatic reconnection attempt on next publish if disconnected

### 2.3 DependencyGraph (Hierarchical mode)

Tracks inter-agent task dependencies for hierarchical execution.

```typescript
// packages/gateway/src/multi-agent/dependency-graph.ts

export interface TaskNode {
  taskId: string;
  assignedAgent: string;
  dependsOn: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: unknown;
}

export class DependencyGraph {
  addNode(taskId: string, agentId: string, dependsOn?: string[]): void;
  getExecutableTasks(): TaskNode[];  // tasks with all dependencies satisfied
  markDone(taskId: string, result: unknown): void;
  isComplete(): boolean;
}
```

### 2.4 ResultAggregator

Structured aggregation for hierarchical results.

```typescript
// packages/gateway/src/multi-agent/result-aggregator.ts

export interface AggregatedResult {
  summary: string;
  perAgentResults: Record<string, unknown>;
  failedTasks: string[];
  totalDurationMs: number;
}

export class ResultAggregator {
  aggregate(taskId: string, results: TaskNode[]): AggregatedResult;
}
```

## 3. Changes to TeamOrchestrator

```typescript
// Updated TeamOrchestrator
private taskAnalyzer: TaskAnalyzer;
private reliableBus: ReliableMessageBus;

runTeamTask(teamId, task, mode) {
  // Replace _splitTask with taskAnalyzer.analyze()
  const assignments = this.taskAnalyzer.analyze(task, members);

  // Use reliableBus for publish instead of bus directly

  // In hierarchical mode, use DependencyGraph for ordering
  if (mode === 'hierarchical') {
    const graph = new DependencyGraph();
    // Add nodes with dependency edges, execute in dependency order
  }
}
```

## 4. Integration Points

| Component | File | Role |
|-----------|------|------|
| `TaskAnalyzer` | `task-analyzer.ts` | New — smart task splitting |
| `ReliableMessageBus` | `reliable-bus.ts` | New — reliability wrapper |
| `DependencyGraph` | `dependency-graph.ts` | New — dependency tracking |
| `ResultAggregator` | `result-aggregator.ts` | New — structured aggregation |
| `TeamOrchestrator` | `team-orchestrator.ts` | Modify — integrate above components |
| `MessageBus` | `bus.ts` | No changes — ReliableMessageBus wraps it |

## 5. Out of Scope

- Changing MessageBus encryption (already AES-256-GCM)
- Adding new agent registration flows
- Persistence layer for dead letter queue (in-memory only for MVP)