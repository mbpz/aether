import type { TaskNode } from './dependency-graph.js';

export interface AggregatedResult {
  summary: string;
  perAgentResults: Record<string, unknown>;
  failedTasks: string[];
  totalDurationMs: number;
}

export class ResultAggregator {
  aggregate(taskId: string, nodes: TaskNode[], startTime: number): AggregatedResult {
    const done = nodes.filter(n => n.status === 'done');
    const failed = nodes.filter(n => n.status === 'failed');

    const perAgentResults: Record<string, unknown> = {};
    for (const node of nodes) {
      if (node.status === 'done' && node.result !== undefined) {
        perAgentResults[node.assignedAgent] = node.result;
      }
    }

    let summary: string;
    if (done.length === 0 && failed.length > 0) {
      summary = `All ${failed.length} tasks failed.`;
    } else if (failed.length === 0) {
      summary = `All ${done.length} tasks completed successfully.`;
    } else {
      summary = `${done.length}/${nodes.length} tasks completed. ${failed.length} failed.`;
    }

    return { summary, perAgentResults, failedTasks: failed.map(n => n.taskId), totalDurationMs: Date.now() - startTime };
  }
}