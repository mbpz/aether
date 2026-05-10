import { describe, it, expect } from 'vitest';
import { ResultAggregator } from './result-aggregator.js';
import { DependencyGraph } from './dependency-graph.js';

describe('ResultAggregator', () => {
  const aggregator = new ResultAggregator();

  it('aggregates all successful results', () => {
    const graph = new DependencyGraph();
    graph.addNode('task-1', 'agent-1', []);
    graph.addNode('task-2', 'agent-2', []);
    graph.markDone('task-1', { output: 'result-1' });
    graph.markDone('task-2', { output: 'result-2' });

    const nodes = [graph.getNode('task-1')!, graph.getNode('task-2')!];
    const result = aggregator.aggregate('root', nodes, Date.now() - 1000);

    expect(result.summary).toContain('2 tasks completed');
    expect(Object.keys(result.perAgentResults)).toHaveLength(2);
    expect(result.failedTasks).toHaveLength(0);
  });

  it('reports failed tasks', () => {
    const graph = new DependencyGraph();
    graph.addNode('task-1', 'agent-1', []);
    graph.markFailed('task-1', 'error');

    const result = aggregator.aggregate('root', [graph.getNode('task-1')!], Date.now() - 1000);

    expect(result.failedTasks).toContain('task-1');
    expect(result.summary).toContain('failed');
  });
});