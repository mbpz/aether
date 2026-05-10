import { describe, it, expect } from 'vitest';
import { TaskAnalyzer } from './task-analyzer.js';
import type { TeamMember } from './team-orchestrator.js';

describe('TaskAnalyzer', () => {
  const analyzer = new TaskAnalyzer();
  const members: TeamMember[] = [
    { agentId: 'agent-1', role: 'planner', capabilities: ['planning'] },
    { agentId: 'agent-2', role: 'executor', capabilities: ['coding'] },
    { agentId: 'agent-3', role: 'reviewer', capabilities: ['analysis'] },
  ];

  describe('analyze()', () => {
    it('assigns executor for code/implement keywords', () => {
      const results = analyzer.analyze('write and implement the authentication module', members);
      const executorResult = results.find(r => r.role === 'executor');
      expect(executorResult).toBeDefined();
      expect(executorResult!.matchScore).toBeGreaterThan(50);
    });

    it('assigns reviewer for analyze/check keywords', () => {
      const results = analyzer.analyze('analyze the security vulnerabilities', members);
      const reviewerResult = results.find(r => r.role === 'reviewer');
      expect(reviewerResult).toBeDefined();
      expect(reviewerResult!.matchScore).toBeGreaterThan(50);
    });

    it('assigns planner for plan/design keywords', () => {
      const results = analyzer.analyze('plan the system architecture', members);
      const plannerResult = results.find(r => r.role === 'planner');
      expect(plannerResult).toBeDefined();
      expect(plannerResult!.matchScore).toBeGreaterThan(50);
    });

    it('returns all members even with no keyword matches', () => {
      const results = analyzer.analyze('do something generic', members);
      expect(results).toHaveLength(3);
    });
  });

  describe('splitTask()', () => {
    it('splits into roughly equal parts', () => {
      const task = 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.';
      const parts = analyzer.splitTask(task, 2);
      expect(parts.length).toBe(2);
    });

    it('returns single part if task is short', () => {
      const parts = analyzer.splitTask('short task', 3);
      expect(parts).toHaveLength(1);
    });
  });
});