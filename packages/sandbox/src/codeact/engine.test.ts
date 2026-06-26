// CodeActEngine contract tests — B8.1 retro-fit.
// Session lifecycle + MAX_STEPS enforcement. Uses real SandboxRuntime
// in scanCode rejection mode (doesn't load ivm).
import { describe, it, expect } from 'vitest';
import { SandboxRuntime } from '../runtime/sandbox.js';
import { SecurityPolicy } from '../security/policy.js';
import { CodeActEngine } from './engine.js';

function makeEngine() {
  const policy = new SecurityPolicy({
    blockNetwork: true,
    blockFilesystem: true,
    blockProcessSpawn: true,
    maxExecTimeMs: 1000,
    maxMemoryMb: 16,
  });
  const runtime = new SandboxRuntime(policy);
  return new CodeActEngine(runtime, policy);
}

describe('CodeActEngine', () => {
  describe('session lifecycle', () => {
    it('createSession returns a session with running status', () => {
      const e = makeEngine();
      const s = e.createSession('build a thing');
      expect(s.task).toBe('build a thing');
      expect(s.status).toBe('running');
      expect(s.steps).toEqual([]);
      expect(s.sessionId).toBeDefined();
      expect(s.startedAt).toBeDefined();
    });

    it('getSession returns the same session', () => {
      const e = makeEngine();
      const s1 = e.createSession('x');
      const s2 = e.getSession(s1.sessionId);
      expect(s2?.sessionId).toBe(s1.sessionId);
    });

    it('listSessions includes created sessions', () => {
      const e = makeEngine();
      e.createSession('a');
      e.createSession('b');
      expect(e.listSessions().length).toBe(2);
    });

    it('completeSession marks status=done', () => {
      const e = makeEngine();
      const s = e.createSession('done-soon');
      const final = e.completeSession(s.sessionId);
      expect(final.status).toBe('done');
      expect(final.completedAt).toBeDefined();
    });
  });

  describe('executeStep (scanCode rejection path)', () => {
    it('records a step even when code is rejected by policy', async () => {
      const e = makeEngine();
      const s = e.createSession('try-network');
      const step = await e.executeStep(s.sessionId, {
        thought: 'fetch a url',
        code: 'fetch("http://example.com")',
      });
      expect(step.stepId).toBeDefined();
      expect(step.thought).toBe('fetch a url');
      // The runtime's scanCode rejection produces ok:false; the engine
      // still records the step.
      const session = e.getSession(s.sessionId)!;
      expect(session.steps.length).toBe(1);
    });

    it('throws when session does not exist', async () => {
      const e = makeEngine();
      await expect(
        e.executeStep('nonexistent', { thought: 't', code: 'noop' }),
      ).rejects.toThrow(/not found/);
    });

    it('throws when MAX_STEPS exceeded', async () => {
      const e = makeEngine();
      const s = e.createSession('loopy');
      // executeStep at step 10 (steps.length=10) throws and sets status='error'.
      // We stop at step 9 then call once more to trigger the throw.
      for (let i = 0; i < 10; i++) {
        try {
          await e.executeStep(s.sessionId, { thought: `t${i}`, code: 'fetch("x")' });
        } catch (err) {
          // Once MAX_STEPS is hit, the session moves to 'error' and
          // subsequent calls throw "is error". That's fine; we just
          // verify a throw happens somewhere in the 10-step loop.
          expect(String(err)).toMatch(/Max steps|is error/);
          return;
        }
      }
      // If we made it here without throwing, the next call must throw.
      await expect(
        e.executeStep(s.sessionId, { thought: 't', code: 'fetch("x")' }),
      ).rejects.toThrow(/Max steps|is error/);
    });

    it('throws when session is not running', async () => {
      const e = makeEngine();
      const s = e.createSession('done');
      e.completeSession(s.sessionId);
      await expect(
        e.executeStep(s.sessionId, { thought: 't', code: 'fetch("x")' }),
      ).rejects.toThrow();
    });
  });
});
