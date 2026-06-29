// KataRuntimeManager contract tests — B14 retro-fit.
// The class depends on @kubernetes/client-node's CoreV1Api, which we
// stub via vitest's module mock so tests don't need a real cluster.
//
// vi.hoisted() ensures the mock fns are created before the vi.mock
// factory runs (vitest hoists vi.mock calls to the top of the file).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createNamespacedPodMock, deleteNamespacedPodMock, readNamespacedPodStatusMock } = vi.hoisted(() => ({
  createNamespacedPodMock: vi.fn(),
  deleteNamespacedPodMock: vi.fn(),
  readNamespacedPodStatusMock: vi.fn(),
}));

vi.mock('@kubernetes/client-node', () => {
  const apiInstance = {
    createNamespacedPod: createNamespacedPodMock,
    deleteNamespacedPod: deleteNamespacedPodMock,
    readNamespacedPodStatus: readNamespacedPodStatusMock,
  };
  class FakeKubeConfig {
    loadFromFile() { /* no-op */ }
    loadFromCluster() { /* no-op */ }
    makeApiClient() { return apiInstance; }
  }
  return {
    KubeConfig: FakeKubeConfig,
    CoreV1Api: class {},
  };
});

import { KataRuntimeManager } from './kata-manager.js';

function makeSpec(overrides: Partial<{ name: string; containerImage: string; maxMemoryMb: number; maxCpu: number }> = {}) {
  return {
    name: 'my-skill',
    containerImage: 'aether/sandbox:latest',
    maxMemoryMb: 256,
    maxCpu: 1,
    ...overrides,
  };
}

describe('KataRuntimeManager', () => {
  beforeEach(() => {
    createNamespacedPodMock.mockReset();
    deleteNamespacedPodMock.mockReset();
    readNamespacedPodStatusMock.mockReset();
    createNamespacedPodMock.mockResolvedValue({});
  });

  describe('createPod — input validation', () => {
    it('throws when containerImage is empty', async () => {
      const mgr = new KataRuntimeManager();
      await expect(
        mgr.createPod(makeSpec({ containerImage: '' })),
      ).rejects.toThrow(/containerImage must be a non-empty string/);
    });

    it('throws when maxMemoryMb <= 0', async () => {
      const mgr = new KataRuntimeManager();
      await expect(
        mgr.createPod(makeSpec({ maxMemoryMb: 0 })),
      ).rejects.toThrow(/maxMemoryMb must be a positive number/);
    });

    it('throws when maxCpu <= 0', async () => {
      const mgr = new KataRuntimeManager();
      await expect(
        mgr.createPod(makeSpec({ maxCpu: -1 })),
      ).rejects.toThrow(/maxCpu must be a positive number/);
    });

    it('throws when name is not a valid DNS subdomain', async () => {
      const mgr = new KataRuntimeManager();
      await expect(
        mgr.createPod(makeSpec({ name: 'Invalid_Name!' })),
      ).rejects.toThrow(/DNS subdomain/);
    });

    it('accepts a minimal valid spec', async () => {
      const mgr = new KataRuntimeManager();
      const name = await mgr.createPod(makeSpec());
      expect(name).toMatch(/^kata-my-skill-/);
    });
  });

  describe('createPod — happy path', () => {
    it('sends a Pod with runtimeClassName=kata', async () => {
      const mgr = new KataRuntimeManager();
      await mgr.createPod(makeSpec());
      const call = createNamespacedPodMock.mock.calls[0][0];
      expect(call.body.spec.runtimeClassName).toBe('kata');
      expect(call.namespace).toBe('aether-sandbox');
    });

    it('sends memory + cpu limits in the right format', async () => {
      const mgr = new KataRuntimeManager();
      await mgr.createPod(makeSpec({ maxMemoryMb: 512, maxCpu: 2 }));
      const call = createNamespacedPodMock.mock.calls[0][0];
      const limits = call.body.spec.containers[0].resources.limits;
      expect(limits.memory).toBe('512Mi');
      expect(limits.cpu).toBe('2');
    });

    it('uses restartPolicy=Never and a readOnlyRootFilesystem securityContext', async () => {
      const mgr = new KataRuntimeManager();
      await mgr.createPod(makeSpec());
      const call = createNamespacedPodMock.mock.calls[0][0];
      expect(call.body.spec.restartPolicy).toBe('Never');
      expect(call.body.spec.containers[0].securityContext.readOnlyRootFilesystem).toBe(true);
      expect(call.body.spec.containers[0].securityContext.allowPrivilegeEscalation).toBe(false);
    });

    it('wraps K8s API errors in a descriptive message', async () => {
      createNamespacedPodMock.mockRejectedValueOnce(new Error('quota exceeded'));
      const mgr = new KataRuntimeManager();
      await expect(mgr.createPod(makeSpec())).rejects.toThrow(/Failed to create pod/);
    });
  });

  describe('deletePod()', () => {
    it('delegates to the K8s API', async () => {
      deleteNamespacedPodMock.mockResolvedValueOnce({});
      const mgr = new KataRuntimeManager();
      await mgr.deletePod('kata-test-1234');
      const call = deleteNamespacedPodMock.mock.calls[0][0];
      expect(call.name).toBe('kata-test-1234');
      expect(call.namespace).toBe('aether-sandbox');
    });

    it('wraps K8s API errors', async () => {
      deleteNamespacedPodMock.mockRejectedValueOnce(new Error('not found'));
      const mgr = new KataRuntimeManager();
      await expect(mgr.deletePod('kata-nope')).rejects.toThrow(/Failed to delete pod/);
    });
  });

  describe('waitForReady()', () => {
    it('returns when the pod reaches Running phase', async () => {
      readNamespacedPodStatusMock.mockResolvedValueOnce({ status: { phase: 'Running' } });
      const mgr = new KataRuntimeManager();
      await expect(mgr.waitForReady('kata-x-1', 5000)).resolves.toBeUndefined();
    });

    it('throws on terminal Failed phase', async () => {
      readNamespacedPodStatusMock.mockResolvedValueOnce({ status: { phase: 'Failed' } });
      const mgr = new KataRuntimeManager();
      await expect(mgr.waitForReady('kata-x-2', 5000)).rejects.toThrow(/terminal phase/);
    });

    it('throws on terminal Unknown phase', async () => {
      readNamespacedPodStatusMock.mockResolvedValueOnce({ status: { phase: 'Unknown' } });
      const mgr = new KataRuntimeManager();
      await expect(mgr.waitForReady('kata-x-3', 5000)).rejects.toThrow(/terminal phase/);
    });

    it('throws when timeout elapses before Running', async () => {
      // Use fake timers to avoid a 30-second wait.
      vi.useFakeTimers();
      try {
        readNamespacedPodStatusMock.mockResolvedValue({ status: { phase: 'Pending' } });
        const mgr = new KataRuntimeManager();
        const promise = mgr.waitForReady('kata-x-4', 1000);
        // Attach a catch handler synchronously so the timeout-induced
        // rejection doesn't bubble up as an unhandled error.
        const handled = promise.catch((e) => e);
        // Advance fake clock past timeout.
        await vi.advanceTimersByTimeAsync(1500);
        const err = await handled;
        expect((err as Error).message).toMatch(/not ready within/);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('custom namespace', () => {
    it('uses the namespace from the constructor', async () => {
      const mgr = new KataRuntimeManager(undefined, 'custom-ns');
      await mgr.createPod(makeSpec());
      expect(createNamespacedPodMock.mock.calls[0][0].namespace).toBe('custom-ns');
    });
  });
});