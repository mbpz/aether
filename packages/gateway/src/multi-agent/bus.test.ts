// MessageBus contract tests — B8.2 retro-fit.
// Focus: queue management + strict-mode (requireSenderKey) + encrypt path.
// Persistent JSONL side-effect is NOT asserted (would need tmpdir + cleanup).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MessageBus } from './bus.js';

describe('MessageBus', () => {
  let workdir: string;
  let bus: MessageBus;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'aether-bus-'));
    bus = new MessageBus({ busFilePath: join(workdir, 'bus.jsonl'), requireSenderKey: false });
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  describe('strict mode (requireSenderKey=true)', () => {
    it('throws when publishing without a sender key', () => {
      const strict = new MessageBus({
        busFilePath: join(workdir, 'bus2.jsonl'),
        requireSenderKey: true,
      });
      expect(() =>
        strict.publish({
          from: 'a',
          to: 'b',
          type: 'request',
          payload: { data: 1 },
        }),
      ).toThrow(/active session key/);
    });

    it('allows publish when an explicit sender key is passed', () => {
      const strict = new MessageBus({
        busFilePath: join(workdir, 'bus3.jsonl'),
        requireSenderKey: true,
      });
      const keyId = strict.createSession('sender-a');
      const key = strict.getSessionKey('sender-a')!;
      const m = strict.publish(
        { from: 'sender-a', to: 'sender-b', type: 'request', payload: { x: 1 } },
        key,
      );
      expect(m.encrypted).toBe(true);
      // keyId should be populated for downstream key rotation logic
      expect(keyId).toBeDefined();
    });

    it('orchestrator can publish without a session key (special case)', () => {
      // The orchestrator bypass path requires the bus to have the
      // orchestrator registered. We use requireSenderKey: false here
      // to verify the orchestrator plaintext branch in isolation;
      // strict-mode + orchestrator as a registered sender is exercised
      // by createSession('orchestrator') in integration tests.
      const m = bus.publish({
        from: 'orchestrator',
        to: 'agent-x',
        type: 'control',
        payload: null,
      });
      // orchestrator is allowed plaintext; payload stays as-is.
      expect(m.encrypted).toBe(false);
    });
  });

  describe('queue management', () => {
    it('ensureQueue creates an empty queue for a new agentId', () => {
      bus.ensureQueue('agent-q');
      // peek should return [] without throwing.
      expect(bus.peek('agent-q', 10)).toEqual([]);
    });

    it('publishing to a fresh agent id creates the queue on demand', () => {
      bus.publish({
        from: 'orchestrator',
        to: 'agent-x',
        type: 'event',
        payload: { ok: true },
      });
      // peek should see the message.
      const peeked = bus.peek('agent-x');
      expect(peeked.length).toBe(1);
      expect(peeked[0].payload).toEqual({ ok: true });
    });
  });

  describe('consume + subscribe', () => {
    it('consume returns and clears queued messages', () => {
      bus.publish({ from: 'orchestrator', to: 'a1', type: 'event', payload: { v: 1 } });
      bus.publish({ from: 'orchestrator', to: 'a1', type: 'event', payload: { v: 2 } });
      const batch = bus.consume('a1', 10);
      expect(batch.length).toBe(2);
      // Second consume returns empty — first call cleared.
      expect(bus.consume('a1', 10)).toEqual([]);
    });

    it('consume respects limit', () => {
      for (let i = 0; i < 5; i++) {
        bus.publish({ from: 'orchestrator', to: 'a2', type: 'event', payload: { i } });
      }
      expect(bus.consume('a2', 3).length).toBe(3);
      // Remaining 2 still queued.
      expect(bus.consume('a2', 10).length).toBe(2);
    });

    it('subscribe fires handler for matching messages', async () => {
      let received: number | null = null;
      bus.subscribe('a3', (msg) => {
        received = (msg.payload as { v: number }).v;
      });
      bus.publish({ from: 'orchestrator', to: 'a3', type: 'event', payload: { v: 42 } });
      // Give EventEmitter microtask a tick.
      await new Promise((r) => setTimeout(r, 5));
      expect(received).toBe(42);
    });

    it('unsubscribe stops handler', async () => {
      let callCount = 0;
      bus.subscribe('a4', () => { callCount++; });
      bus.publish({ from: 'orchestrator', to: 'a4', type: 'event', payload: { v: 1 } });
      await new Promise((r) => setTimeout(r, 5));
      bus.unsubscribe('a4');
      bus.publish({ from: 'orchestrator', to: 'a4', type: 'event', payload: { v: 2 } });
      await new Promise((r) => setTimeout(r, 5));
      expect(callCount).toBe(1);
    });
  });

  describe('peek is non-destructive', () => {
    it('peek returns the same messages on repeated calls', () => {
      bus.publish({ from: 'orchestrator', to: 'a5', type: 'event', payload: { x: 1 } });
      expect(bus.peek('a5').length).toBe(1);
      expect(bus.peek('a5').length).toBe(1);
    });
  });
});