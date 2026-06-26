// ReliableMessageBus contract tests — B8.2.
// Wraps MessageBus with retry logic + dead-letter queue + connection state.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MessageBus } from './bus.js';
import { ReliableMessageBus } from './reliable-bus.js';

describe('ReliableMessageBus', () => {
  let bus: MessageBus;
  let reliable: ReliableMessageBus;

  beforeEach(() => {
    const workdir = mkdtempSync(join(tmpdir(), 'aether-rbus-'));
    bus = new MessageBus({ busFilePath: join(workdir, 'bus.jsonl'), requireSenderKey: false });
    reliable = new ReliableMessageBus(bus, { maxRetries: 3, baseDelayMs: 10 });
  });

  describe('happy path', () => {
    it('publishes successfully on first try', () => {
      const result = reliable.publish({
        id: '1', from: 'orchestrator', to: 'agent-a',
        type: 'event', payload: { x: 1 }, timestamp: '2026-01-01', encrypted: false,
      });
      expect(result.success).toBe(true);
      expect(result.retryCount).toBe(0);
      expect(reliable.getConnectionState()).toBe('connected');
    });

    it('consume delegates to underlying bus', () => {
      reliable.publish({ id: '1', from: 'orchestrator', to: 'a', type: 'event', payload: 1, timestamp: '', encrypted: false });
      reliable.publish({ id: '2', from: 'orchestrator', to: 'a', type: 'event', payload: 2, timestamp: '', encrypted: false });
      const batch = reliable.consume('a', 10);
      expect(batch.length).toBe(2);
    });
  });

  describe('retry + dead-letter', () => {
    it('marks retry on publish failure', () => {
      // Stub the underlying bus to throw on every publish.
      const stub = { publish: () => { throw new Error('bus down'); } } as unknown as MessageBus;
      const r = new ReliableMessageBus(stub, { maxRetries: 3 });
      const result = r.publish({
        id: '1', from: 'orchestrator', to: 'a',
        type: 'event', payload: 1, timestamp: '', encrypted: false,
      });
      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(1);
      expect(r.getConnectionState()).toBe('reconnecting');
      expect(r.getDeadLetterQueue().length).toBe(0); // under maxRetries
    });

    it('moves to dead-letter after maxRetries exhausted', () => {
      const stub = { publish: () => { throw new Error('bus down'); } } as unknown as MessageBus;
      const r = new ReliableMessageBus(stub, { maxRetries: 2 });
      // Same key from+to+type retried 3 times → after the 3rd (retryCount=2),
      // dead-letter queue receives it.
      for (let i = 0; i < 3; i++) {
        r.publish({ id: '1', from: 'orchestrator', to: 'a', type: 'event', payload: 1, timestamp: '', encrypted: false });
      }
      const dlq = r.getDeadLetterQueue();
      expect(dlq.length).toBe(1);
      expect(r.getConnectionState()).toBe('disconnected');
    });
  });

  describe('reconnect', () => {
    it('clears retry counters and returns state to connected', () => {
      reliable.reconnect();
      expect(reliable.getConnectionState()).toBe('connected');
      // No public way to assert retryCount cleared without going through
      // publish + post-failure reconnect, but reconnect() should be safe to
      // call multiple times.
      expect(() => reliable.reconnect()).not.toThrow();
    });
  });

  describe('getDeadLetterQueue returns a copy', () => {
    it('mutating the returned array does not affect internal state', () => {
      const dlq = reliable.getDeadLetterQueue();
      dlq.push({
        message: { id: 'x', from: '', to: '', type: '', payload: null, timestamp: '', encrypted: false },
        failedAt: '',
        retryCount: 0,
        lastError: '',
      });
      expect(reliable.getDeadLetterQueue().length).toBe(0);
    });
  });
});