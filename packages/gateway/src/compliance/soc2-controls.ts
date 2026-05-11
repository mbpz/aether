// SOC2 Control Definitions
// Enterprise Compliance Report Generator - T-019
// EP-06: Enterprise Deployment

/**
 * SOC2 Trust Service Criteria (TSC) Controls
 * Based on AICPA Trust Service Criteria 2017
 */
export const SOC2_CONTROLS = {
  // CC1: Control Environment
  CC1: {
    id: 'CC1',
    title: 'Control Environment',
    description: 'The entity demonstrates a commitment to integrity and ethical values.',
    requirements: [
      {
        id: 'CC1.1',
        title: 'Board Oversight',
        description: 'The board of directors demonstrates independence from management and exercises oversight.',
        category: 'governance',
      },
      {
        id: 'CC1.2',
        title: 'Management Philosophy',
        description: 'Management demonstrates a commitment to integrity and ethical values.',
        category: 'culture',
      },
      {
        id: 'CC1.3',
        title: 'Organizational Structure',
        description: 'The entity maintains organizational structures, reporting lines, and authorities appropriate for its size and complexity.',
        category: 'structure',
      },
      {
        id: 'CC1.4',
        title: 'HR Policies',
        description: 'The entity demonstrates competence in attracting, developing, and retaining individuals.',
        category: 'human_resources',
      },
    ],
  },

  // CC2: Communication
  CC2: {
    id: 'CC2',
    title: 'Communication',
    description: 'The entity communicates internally and externally regarding internal control matters.',
    requirements: [
      {
        id: 'CC2.1',
        title: 'Internal Communication',
        description: 'The entity internally communicates information necessary to support the functioning of internal control.',
        category: 'internal',
      },
      {
        id: 'CC2.2',
        title: 'External Communication',
        description: 'The entity externally communicates with customers, vendors, and regulators regarding matters affecting internal control.',
        category: 'external',
      },
      {
        id: 'CC2.3',
        title: 'Audit Logging',
        description: 'The entity maintains audit logs sufficient to support the functioning of internal control.',
        category: 'documentation',
      },
    ],
  },

  // CC3: Risk Assessment
  CC3: {
    id: 'CC3',
    title: 'Risk Assessment',
    description: 'The entity specifies objectives with sufficient clarity to enable identification of risks.',
    requirements: [
      {
        id: 'CC3.1',
        title: 'Risk Identification',
        description: 'The entity identifies risks to the achievement of objectives and analyzes risks.',
        category: 'identification',
      },
      {
        id: 'CC3.2',
        title: 'Security Assessment',
        description: 'The entity assesses security risks and implements controls to mitigate identified risks.',
        category: 'analysis',
      },
      {
        id: 'CC3.3',
        title: 'Third-Party Risk',
        description: 'The entity identifies and analyzes risks associated with third-party services.',
        category: 'third_party',
      },
    ],
  },

  // CC4: Monitoring
  CC4: {
    id: 'CC4',
    title: 'Monitoring',
    description: 'The entity selects and develops ongoing evaluations to ascertain internal control effectiveness.',
    requirements: [
      {
        id: 'CC4.1',
        title: 'Continuous Monitoring',
        description: 'The entity conducts ongoing evaluations to determine if internal control is effective.',
        category: 'ongoing',
      },
      {
        id: 'CC4.2',
        title: 'Deficiency Reporting',
        description: 'The entity evaluates and communicates internal control deficiencies in a timely manner.',
        category: 'reporting',
      },
    ],
  },

  // CC5: Control Activities
  CC5: {
    id: 'CC5',
    title: 'Control Activities',
    description: 'The entity selects and develops control activities to mitigate risks.',
    requirements: [
      {
        id: 'CC5.1',
        title: 'Encryption Controls',
        description: 'The entity implements encryption controls to protect data at rest and in transit.',
        category: 'encryption',
      },
      {
        id: 'CC5.2',
        title: 'Access Management',
        description: 'The entity implements access management controls to restrict access to sensitive systems.',
        category: 'access',
      },
      {
        id: 'CC5.3',
        title: 'Change Management',
        description: 'The entity implements change management controls to manage changes to systems.',
        category: 'change_management',
      },
    ],
  },

  // CC6: Logical Access
  CC6: {
    id: 'CC6',
    title: 'Logical Access',
    description: 'The entity implements logical access controls to protect against unauthorized access.',
    requirements: [
      {
        id: 'CC6.1',
        title: 'Authentication',
        description: 'The entity implements authentication controls to verify user identity.',
        category: 'authentication',
      },
      {
        id: 'CC6.2',
        title: 'Authorization',
        description: 'The entity implements authorization controls to restrict access based on user permissions.',
        category: 'authorization',
      },
      {
        id: 'CC6.3',
        title: 'Access Review',
        description: 'The entity conducts periodic access reviews to ensure access is appropriate.',
        category: 'review',
      },
      {
        id: 'CC6.4',
        title: 'Session Management',
        description: 'The entity implements session management controls to manage user sessions.',
        category: 'session',
      },
      {
        id: 'CC6.5',
        title: 'Network Segmentation',
        description: 'The entity implements network segmentation to isolate sensitive systems.',
        category: 'network',
      },
    ],
  },

  // CC7: System Operations
  CC7: {
    id: 'CC7',
    title: 'System Operations',
    description: 'The entity manages day-to-day operations and monitors compliance with established controls.',
    requirements: [
      {
        id: 'CC7.1',
        title: 'Incident Response',
        description: 'The entity implements incident response procedures to address security incidents.',
        category: 'incident_response',
      },
      {
        id: 'CC7.2',
        title: 'Vulnerability Management',
        description: 'The entity implements vulnerability management to identify and mitigate system vulnerabilities.',
        category: 'vulnerability',
      },
      {
        id: 'CC7.3',
        title: 'Malware Protection',
        description: 'The entity implements malware protection controls.',
        category: 'malware',
      },
    ],
  },

  // CC8: Change Management
  CC8: {
    id: 'CC8',
    title: 'Change Management',
    description: 'The entity manages changes to system components and assesses risks.',
    requirements: [
      {
        id: 'CC8.1',
        title: 'Change Approval',
        description: 'The entity implements change approval procedures for system changes.',
        category: 'approval',
      },
      {
        id: 'CC8.2',
        title: 'Change Testing',
        description: 'The entity tests changes before deployment to production.',
        category: 'testing',
      },
      {
        id: 'CC8.3',
        title: 'Change Documentation',
        description: 'The entity documents all system changes for audit purposes.',
        category: 'documentation',
      },
    ],
  },

  // CC9: Risk Mitigation
  CC9: {
    id: 'CC9',
    title: 'Risk Mitigation',
    description: 'The entity identifies, selects, and develops risk mitigation activities.',
    requirements: [
      {
        id: 'CC9.1',
        title: 'Backup Controls',
        description: 'The entity implements backup controls to protect data availability.',
        category: 'backup',
      },
      {
        id: 'CC9.2',
        title: 'Disaster Recovery',
        description: 'The entity implements disaster recovery procedures to restore systems after disruption.',
        category: 'disaster_recovery',
      },
      {
        id: 'CC9.3',
        title: 'Business Continuity',
        description: 'The entity implements business continuity planning to maintain operations during disruptions.',
        category: 'continuity',
      },
    ],
  },
} as const;

/**
 * Framework types supported by the compliance report generator
 */
export type ComplianceFramework = 'SOC2' | 'GDPR' | 'HIPAA' | 'ISO27001' | 'custom';

/**
 * SOC2 Control category mapping to compliance check functions
 */
export interface ControlMapping {
  controlId: string;
  checkFunction: string;
  evidenceTypes: EvidenceType[];
}

export type EvidenceType = 'log' | 'config' | 'audit' | 'screenshot';

/**
 * Maps SOC2 controls to evidence types needed for compliance checks
 */
export const CONTROL_EVIDENCE_MAPPING: Record<string, EvidenceType[]> = {
  CC1: ['config', 'audit'],
  CC2: ['log', 'audit'],
  CC3: ['config', 'audit'],
  CC4: ['log', 'audit'],
  CC5: ['config', 'log'],
  CC6: ['log', 'config', 'audit'],
  CC7: ['log', 'config', 'audit'],
  CC8: ['config', 'audit'],
  CC9: ['config', 'audit', 'log'],
};

/**
 * Get all SOC2 control IDs
 */
export function getAllControlIds(): string[] {
  return Object.values(SOC2_CONTROLS).flatMap((control) =>
    control.requirements.map((req) => req.id)
  );
}

/**
 * Get control by ID
 */
export function getControlById(controlId: string): { control: typeof SOC2_CONTROLS[keyof typeof SOC2_CONTROLS]; requirement?: { id: string; title: string; description: string; category: string } } | null {
  for (const control of Object.values(SOC2_CONTROLS)) {
    if (control.id === controlId) {
      return { control, requirement: undefined };
    }
    const requirement = control.requirements.find((r) => r.id === controlId);
    if (requirement) {
      return { control, requirement };
    }
  }
  return null;
}
