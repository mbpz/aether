export interface TaskNode {
  taskId: string;
  assignedAgent: string;
  dependsOn: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: unknown;
  error?: string;
}

export class DependencyGraph {
  private nodes = new Map<string, TaskNode>();

  addNode(taskId: string, agentId: string, dependsOn: string[] = []): void {
    this.nodes.set(taskId, { taskId, assignedAgent: agentId, dependsOn, status: 'pending' });
  }

  getNode(taskId: string): TaskNode | undefined {
    return this.nodes.get(taskId);
  }

  getExecutableTasks(): TaskNode[] {
    const result: TaskNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.status !== 'pending') continue;
      const allDepsDone = node.dependsOn.every(depId => {
        const dep = this.nodes.get(depId);
        return dep?.status === 'done';
      });
      if (allDepsDone) result.push(node);
    }
    return result;
  }

  markRunning(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (node) node.status = 'running';
  }

  markDone(taskId: string, result: unknown): void {
    const node = this.nodes.get(taskId);
    if (node) { node.status = 'done'; node.result = result; }
  }

  markFailed(taskId: string, error: string): void {
    const node = this.nodes.get(taskId);
    if (node) { node.status = 'failed'; node.error = error; }
  }

  isComplete(): boolean {
    for (const node of this.nodes.values()) {
      if (node.status !== 'done' && node.status !== 'failed') return false;
    }
    return true;
  }

  getFailedNodes(): TaskNode[] {
    return Array.from(this.nodes.values()).filter(n => n.status === 'failed');
  }
}