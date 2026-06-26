// TeamOrchestrator contract tests — B8.2.
// Tests createTeam + disbandTeam + runTeamTask error paths. The happy
// path of runTeamTask needs the sandbox to execute code, which requires
// isolated-vm; we defer that to integration tests (B9+).
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
    const workdir = mkdtempSync(join(tmpdir(), 'aether-team-'));
    registry = new AgentRegistry();
    bus = new MessageBus({ busFilePath: join(workdir, 'bus.jsonl') });
    sandboxes = new AgentSandboxManager();
    orch = new TeamOrchestrator(registry, bus, sandboxes);
  });

  describe('createTeam', () => {
    it('returns a team id', () => {
      const teamId = orch.createTeam('alpha', [
        { agentId: 'a1', role: 'planner' },
        { agentId: 'a2', role: 'executor' },
      ]);
      expect(teamId).toBeDefined();
    });

    it('emits a team.joined message to each member', async () => {
      const a1 = registry.register({ name: 'a1', role: 'planner' });
      const a2 = registry.register({ name: 'a2', role: 'executor' });
      orch.createTeam('alpha', [
        { agentId: a1.id, role: 'planner' },
        { agentId: a2.id, role: 'executor' },
      ]);
      // Members should each have received a team.joined message.
      const a1Msgs = bus.peek(a1.id);
      const a2Msgs = bus.peek(a2.id);
      expect(a1Msgs.length).toBe(1);
      expect(a2Msgs.length).toBe(1);
      expect(a1Msgs[0].type).toBe('task');
    });
  });

  describe('runTeamTask error paths', () => {
    it('returns ok:false for unknown team id', async () => {
      const r = await orch.runTeamTask('nonexistent', 'do something');
      expect(r.ok).toBe(false);
      expect(r.error).toBeDefined();
    });

    it('returns ok:false for a team with no members', async () => {
      const teamId = orch.createTeam('empty', []);
      const r = await orch.runTeamTask(teamId, 'do something');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/no members/);
    });
  });

  describe('disbandTeam', () => {
    it('removes the team', async () => {
      const teamId = orch.createTeam('alpha', [
        { agentId: 'a1', role: 'planner' },
      ]);
      orch.disbandTeam(teamId);
      // After disband, runTeamTask on the same id returns the "not found"
      // error path.
      const r = await orch.runTeamTask(teamId, 'task');
      expect(r.error).toMatch(/Team not found/);
    });

    it('does not throw for unknown team id', () => {
      expect(() => orch.disbandTeam('nope')).not.toThrow();
    });
  });
});