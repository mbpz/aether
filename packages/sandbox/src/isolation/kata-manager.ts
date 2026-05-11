import { KubeConfig, CoreV1Api } from '@kubernetes/client-node';
import { v4 as uuid } from 'uuid';

export interface KataPodSpec {
  name: string;
  containerImage: string;
  maxMemoryMb: number;
  maxCpu: number;
  command?: string[];
}

export class KataRuntimeManager {
  private k8sApi: CoreV1Api;
  private namespace: string;

  constructor(kubeconfigPath?: string) {
    const kc = new KubeConfig();
    if (kubeconfigPath) {
      kc.loadFromFile(kubeconfigPath);
    } else {
      kc.loadFromCluster();
    }
    this.k8sApi = kc.makeApiClient(CoreV1Api);
    this.namespace = 'aether-sandbox';
  }

  /**
   * Create a Kata Container pod.
   */
  async createPod(spec: KataPodSpec): Promise<string> {
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

    await this.k8sApi.createNamespacedPod(this.namespace, pod);
    return podName;
  }

  /**
   * Delete a Kata Container pod.
   */
  async deletePod(podName: string): Promise<void> {
    await this.k8sApi.deleteNamespacedPod(podName, this.namespace);
  }

  /**
   * Wait for pod to be Running.
   */
  async waitForReady(podName: string, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { body } = await this.k8sApi.readNamespacedPodStatus(podName, this.namespace);
      if (body.status?.phase === 'Running') return;
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Pod ${podName} not ready within ${timeoutMs}ms`);
  }
}