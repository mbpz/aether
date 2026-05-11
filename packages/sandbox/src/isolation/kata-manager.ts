import { KubeConfig, CoreV1Api } from '@kubernetes/client-node';
import { v4 as uuid } from 'uuid';

// DNS subdomain validation: lowercase alphanumeric, hyphens, max 253 chars
const DNS_SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export interface KataPodSpec {
  name: string;
  containerImage: string;
  maxMemoryMb: number;
  maxCpu: number;
  command?: string[];
}

function validateKataPodSpec(spec: KataPodSpec): void {
  if (!spec.containerImage || spec.containerImage.trim() === '') {
    throw new Error('containerImage must be a non-empty string');
  }
  if (spec.maxMemoryMb <= 0) {
    throw new Error('maxMemoryMb must be a positive number');
  }
  if (spec.maxCpu <= 0) {
    throw new Error('maxCpu must be a positive number');
  }
  if (!DNS_SUBDOMAIN_REGEX.test(spec.name)) {
    throw new Error('name must be a valid DNS subdomain (lowercase alphanumeric, hyphens allowed, max 253 chars, cannot start/end with hyphen)');
  }
}

export class KataRuntimeManager {
  private k8sApi: CoreV1Api;
  private namespace: string;

  constructor(kubeconfigPath?: string, namespace = 'aether-sandbox') {
    const kc = new KubeConfig();
    if (kubeconfigPath) {
      kc.loadFromFile(kubeconfigPath);
    } else {
      kc.loadFromCluster();
    }
    this.k8sApi = kc.makeApiClient(CoreV1Api);
    this.namespace = namespace;
  }

  /**
   * Create a Kata Container pod.
   */
  async createPod(spec: KataPodSpec): Promise<string> {
    validateKataPodSpec(spec);

    const podName = `kata-${spec.name}-${uuid().slice(0, 8)}`;

    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: podName, namespace: this.namespace },
      spec: {
        runtimeClassName: 'kata',
        containers: [{
          name: 'sandbox',
          image: spec.containerImage,
          command: spec.command ?? ['sleep', '3600'],
          resources: {
            limits: { memory: `${spec.maxMemoryMb}Mi`, cpu: `${spec.maxCpu}` },
            requests: { memory: '64Mi', cpu: '100m' },
          },
          securityContext: {
            readOnlyRootFilesystem: true,
            allowPrivilegeEscalation: false,
          },
        }],
        restartPolicy: 'Never',
      },
    };

    try {
      await this.k8sApi.createNamespacedPod(this.namespace, pod);
    } catch (err) {
      throw new Error(`Failed to create pod ${podName} in namespace ${this.namespace}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return podName;
  }

  /**
   * Delete a Kata Container pod.
   */
  async deletePod(podName: string): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedPod(podName, this.namespace);
    } catch (err) {
      throw new Error(`Failed to delete pod ${podName} in namespace ${this.namespace}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Wait for pod to be Running.
   */
  async waitForReady(podName: string, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let phase: string;
      try {
        const { body } = await this.k8sApi.readNamespacedPodStatus(podName, this.namespace);
        phase = body.status?.phase ?? 'Unknown';
      } catch (err) {
        throw new Error(`Failed to read pod ${podName} status in namespace ${this.namespace}: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (phase === 'Running') return;
      if (phase === 'Failed' || phase === 'Unknown') {
        throw new Error(`Pod ${podName} entered terminal phase "${phase}" while waiting for Ready`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Pod ${podName} not ready within ${timeoutMs}ms`);
  }
}