// TeamOrchestrator contract tests — B14 retro-fit.
// runTeamTask() requires the sandbox runtime + LLM provider +
// registry to be wired in. We focus the tests on the pure paths
// (createTeam + disbandTeam + constructor wiring) and the
// runTeamTask input-validation branches. The happy-path execution
// is exercised in the B9/B15 integration suite.
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from './registry.js';
import { MessageBus } from './bus.js';
import { AgentSandboxManager } from './sandbox-executor.js';
import { TeamOrchestrator } from './team-orchestrator.js';

describe('TeamOrchestrator', () => {
  let registry: AgentRegistry;
  let bus: MessageBus;
  let sandboxes: AgentSandboxManager;
  let orch: TeamOrchestrator;

  beforeEach(() => {
    registry = new AgentRegistry();
    bus = new MessageBus();
    sandboxes = new AgentSandboxManager();
    orch = new TeamOrchestrator(registry, bus, sandboxes);
  });

  describe('createTeam()', () => {
    it('returns a unique team id and publishes a team.joined event to each member', () => {
      const id1 = orch.createTeam('alpha', [
        { agentId: 'a1', role: 'planner' },
        { agentId: 'a2', role: 'executor' },
      ]);
      const id2 = orch.createTeam('beta', [
        { agentId: 'b1', role: 'reviewer' },
      ]);
      expect(id1).not.toBe(id2);
      // Each agent has a queued team.joined event.
      const a1Msgs = bus.peek('a1');
      const b1Msgs = bus.peek('b1');
      expect(a1Msgs.length).toBe(1);
      expect(b1Msgs.length).toBe(1);
    });

    it('tolerates an empty members list (creates team with no recipients)', () => {
      const id = orch.createTeam('empty', []);
      expect(id).toBeDefined();
    });
  });

  describe('runTeamTask() — input validation', () => {
    it('returns ok:false for an unknown team id', async () => {
      const r = await orch.runTeamTask('not-a-team', 'do work');
      expect(r.ok).toBe(false);
      expect(r.error).toBeDefined();
    });

    it('returns ok:false for a team with no members', async () => {
      const id = orch.createTeam('empty', []);
      const r = await orch.runTeamTask(id, 'do work');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/no members/);
    });
  });

  describe('runQuickTeam() — input validation', () => {
    it('returns ok:false when agentIds is empty', async () => {
      const r = await orch.runQuickTeam('analyze this', []);
      expect(r.ok).toBe(false);
    });
  });
});