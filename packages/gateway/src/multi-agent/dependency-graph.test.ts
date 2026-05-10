import { describe, it, expect } from 'vitest';
import { DependencyGraph } from './dependency-graph.js';

describe('DependencyGraph', () => {
  it('adds nodes correctly', () => {
    const graph = new DependencyGraph();
    graph.addNode('task-1', 'agent-1', []);
    const node = graph.getNode('task-1');
    expect(node).toBeDefined();
    expect(node!.assignedAgent).toBe('agent-1');
  });

  it('getExecutableTasks returns tasks with satisfied dependencies', () => {
    const graph = new DependencyGraph();
    graph.addNode('task-1', 'agent-1', []);
    graph.addNode('task-2', 'agent-2', ['task-1']);
    graph.addNode('task-3', 'agent-3', ['task-1']);

    const exec = graph.getExecutableTasks();
    expect(exec.map(n => n.taskId)).toContain('task-1');

    graph.markDone('task-1', 'result-1');
    const exec2 = graph.getExecutableTasks();
    expect(exec2.map(n => n.taskId)).toContain('task-2');
    expect(exec2.map(n => n.taskId)).toContain('task-3');
  });

  it('isComplete returns true when all nodes done or failed', () => {
    const graph = new DependencyGraph();
    graph.addNode('task-1', 'agent-1', []);
    graph.addNode('task-2', 'agent-2', []);
    graph.markDone('task-1', 'result');
    graph.markDone('task-2', 'result');
    expect(graph.isComplete()).toBe(true);
  });

  it('marks failed nodes correctly', () => {
    const graph = new DependencyGraph();
    graph.addNode('task-1', 'agent-1', []);
    graph.markFailed('task-1', 'something went wrong');
    const node = graph.getNode('task-1');
    expect(node!.status).toBe('failed');
    expect(node!.error).toBe('something went wrong');
  });
});