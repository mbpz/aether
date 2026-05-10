export type IssueType = 'network' | 'filesystem' | 'exec' | 'eval' | 'secrets' | 'permission_mismatch';
export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AuditIssue {
  type: IssueType;
  severity: IssueSeverity;
  location?: string;
  description: string;
}

export interface AuditReport {
  skillId: string;
  skillName: string;
  trustScore: number;
  allowed: boolean;
  issues: AuditIssue[];
  scannedAt: string;
  source: 'manus' | 'openclaw' | 'aether' | 'skillpack' | 'unknown';
}

export interface AuditConfig {
  threshold?: number;
  allowedNetworkHosts?: string[];
}