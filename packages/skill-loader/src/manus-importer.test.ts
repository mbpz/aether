import { describe, it, expect } from 'vitest';
import {
  importManusPlaybook,
  parseManusPlaybook,
  validatePlaybook,
  isManusPlaybook,
} from './manus-importer.js';

// =============================================================================
// Manus Playbook format detection
// =============================================================================

describe('isManusPlaybook', () => {
  it('detects playbook: true in frontmatter', () => {
    const content = `---
playbook: true
name: Test Playbook
---
# Steps
- step 1`;
    expect(isManusPlaybook(content)).toBe(true);
  });

  it('detects steps array in frontmatter', () => {
    const content = `---
name: Playbook with Steps
steps:
  - name: Step 1
---
`;
    expect(isManusPlaybook(content)).toBe(true);
  });

  it('detects steps pattern in body', () => {
    const content = `---
name: Playbook
---
# Steps
- step 1: First step
  action: do something
`;
    expect(isManusPlaybook(content)).toBe(true);
  });

  it('returns false for non-playbook content', () => {
    const content = `# Just a regular document
No playbook here`;
    expect(isManusPlaybook(content)).toBe(false);
  });
});

// =============================================================================
// Manus Playbook parsing
// =============================================================================

describe('parseManusPlaybook', () => {
  it('parses basic playbook with frontmatter', () => {
    const content = `---
playbook: true
name: Code Deployment Playbook
version: 1.0.0
description: Deploy code to production
trigger: deploy
triggers:
  - deploy
  - release
---
steps:
  - name: Checkout
    description: Checkout repository
    action: git checkout
  - name: Build
    description: Build the project
    action: npm run build
`;
    const result = parseManusPlaybook(content);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Code Deployment Playbook');
    expect(result?.version).toBe('1.0.0');
    expect(result?.description).toBe('Deploy code to production');
    expect(result?.triggers).toContain('deploy');
    expect(result?.triggers).toContain('release');
  });

  it('parses steps from body', () => {
    const content = `---
playbook: true
name: Test Playbook
---
steps:
  - name: First Step
    description: Do the first thing
    action: echo "hello"
  - name: Second Step
    action: echo "world"
`;
    const result = parseManusPlaybook(content);
    expect(result?.steps).toHaveLength(2);
    expect(result?.steps[0].name).toBe('First Step');
    expect(result?.steps[0].action).toBe('echo "hello"');
    expect(result?.steps[1].name).toBe('Second Step');
  });

  it('parses variables from frontmatter', () => {
    const content = `---
playbook: true
name: Variable Playbook
variables:
  - name: ENVIRONMENT
    description: Target environment
    default: production
    required: true
  - name: REGION
    default: us-west-2
---
`;
    const result = parseManusPlaybook(content);
    expect(result?.variables).toBeDefined();
    expect(result?.variables).toHaveLength(2);
    expect(result?.variables![0].name).toBe('ENVIRONMENT');
    expect(result?.variables![0].default).toBe('production');
    expect(result?.variables![0].required).toBe(true);
  });

  it('parses env_vars', () => {
    const content = `---
playbook: true
name: Env Playbook
env_vars:
  API_KEY: secret123
  DB_HOST: localhost
---
`;
    const result = parseManusPlaybook(content);
    expect(result?.env_vars).toEqual({
      API_KEY: 'secret123',
      DB_HOST: 'localhost',
    });
  });

  it('returns null for non-playbook content', () => {
    const content = `# Just a regular skill
## System Prompt
Do something`;
    expect(parseManusPlaybook(content)).toBeNull();
  });
});

// =============================================================================
// Validation
// =============================================================================

describe('validatePlaybook', () => {
  it('validates complete playbook', () => {
    const playbook = {
      playbook: true,
      name: 'Valid Playbook',
      steps: [
        { name: 'Step 1', action: 'do thing' },
        { name: 'Step 2', action: 'do other thing' },
      ],
    };
    const result = validatePlaybook(playbook);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects playbook without name', () => {
    const playbook = {
      playbook: true,
      name: '',
      steps: [{ name: 'Step 1' }],
    };
    const result = validatePlaybook(playbook);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Playbook name is required');
  });

  it('rejects playbook without steps', () => {
    const playbook = {
      playbook: true,
      name: 'No Steps Playbook',
      steps: [],
    };
    const result = validatePlaybook(playbook);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Playbook must have at least one step');
  });

  it('rejects steps without names', () => {
    const playbook = {
      playbook: true,
      name: 'Bad Steps Playbook',
      steps: [
        { name: '' },
        { name: 'Valid Step' },
      ],
    };
    const result = validatePlaybook(playbook);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Step 1 is missing a name');
  });
});

// =============================================================================
// Import to Aether format
// =============================================================================

describe('importManusPlaybook', () => {
  it('converts basic playbook to Aether format', () => {
    const content = `---
playbook: true
name: Deployment Playbook
version: 1.0.0
description: Deploy application to cloud
triggers:
  - deploy
  - release
---
steps:
  - name: Checkout Code
    description: Clone the repository
    action: git clone https://github.com/example/repo.git
  - name: Install Dependencies
    action: npm install
  - name: Run Tests
    action: npm test
    timeout: 300
`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output).toContain('aether-skill: true');
    expect(result.output).toContain('name: Deployment Playbook');
    expect(result.output).toContain('# Level 1: Metadata');
    expect(result.output).toContain('# Level 2: Instructions');
    expect(result.output).toContain('## Steps');
    expect(result.output).toContain('### Step 1: Checkout Code');
    expect(result.output).toContain('### Step 2: Install Dependencies');
    expect(result.output).toContain('### Step 3: Run Tests');
  });

  it('maps triggers to Level 1 metadata', () => {
    const content = `---
playbook: true
name: Trigger Playbook
trigger: manual
triggers:
  - manual
  - webhook
---
steps:
  - name: Do Work
    action: echo "working"
`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(true);
    expect(result.output).toContain('triggers:');
    expect(result.output).toContain('- manual');
    expect(result.output).toContain('- webhook');
  });

  it('maps variables to env_vars', () => {
    const content = `---
playbook: true
name: Variable Playbook
variables:
  - name: ENV
    default: production
  - name: REGION
    default: us-west-2
---
steps:
  - name: Set Variables
    action: export
`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(true);
    expect(result.output).toContain('env_vars:');
    expect(result.output).toContain('ENV:');
    expect(result.output).toContain('REGION:');
  });

  it('adds warnings for playbooks with many steps', () => {
    const manySteps = Array.from({ length: 15 }, (_, i) => `
  - name: Step ${i + 1}
    action: echo "${i + 1}"`).join('\n');

    const content = `---
playbook: true
name: Large Playbook
---
steps:${manySteps}
`;
    const result = importManusPlaybook(content);
    expect(result.warnings).toContain('Playbook has many steps - consider breaking into smaller skills');
  });

  it('returns error for non-playbook content', () => {
    const content = `# Not a Playbook
## System Prompt
Just a regular skill`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Content does not appear to be a Manus Playbook format');
  });

  it('returns error for playbook without name', () => {
    const content = `---
playbook: true
---
steps:
  - name: Step 1
    action: do something
`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Playbook must have a name');
  });

  it('warns about empty steps', () => {
    const content = `---
playbook: true
name: Empty Playbook
---
`;
    const result = importManusPlaybook(content);
    expect(result.warnings).toContain('Playbook has no steps - creating empty instruction set');
  });

  it('handles step conditions and timeouts', () => {
    const content = `---
playbook: true
name: Conditional Playbook
---
steps:
  - name: Deploy
    description: Deploy if tests pass
    action: kubectl apply -f deployment.yaml
    conditions:
      - tests_passed
      - approved
    timeout: 600
`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(true);
    expect(result.output).toContain('**Conditions:**');
    expect(result.output).toContain('- tests_passed');
    expect(result.output).toContain('**Timeout:** 600s');
  });

  it('includes environment variables in Level 3', () => {
    const content = `---
playbook: true
name: Env Test
env_vars:
  DATABASE_URL: postgres://localhost/db
  API_KEY: secret
---
steps:
  - name: Connect
    action: connect to database
`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(true);
    expect(result.output).toContain('# Level 3: Resources');
    expect(result.output).toContain('## Environment Variables');
  });

  it('handles playbook metadata', () => {
    const content = `---
playbook: true
name: Meta Playbook
version: 2.0.0
description: A playbook with metadata
author: Test Author
category: automation
---
steps:
  - name: Step 1
    action: do it
`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(true);
    expect(result.output).toContain('version: 2.0.0');
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('manus-importer edge cases', () => {
  it('handles malformed YAML gracefully', () => {
    // Valid frontmatter but content that might challenge parsing
    const content = `---
playbook: true
name: Test Playbook
description: A description with unusual chars "quotes" and 'apostrophes'
---
steps:
  - name: Step 1
    description: With "quotes" and 'apostrophes'
    action: |
      multi-line
      script
`;
    const result = importManusPlaybook(content);
    // Should succeed with valid frontmatter
    expect(result.success).toBe(true);
  });

  it('handles empty content', () => {
    const result = importManusPlaybook('');
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles playbook with only frontmatter', () => {
    const content = `---
playbook: true
name: Frontmatter Only
version: 1.0.0
---
`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(true);
    expect(result.output).toContain('# Level 2: Instructions');
    expect(result.output).toContain('_No steps defined_');
  });

  it('preserves step descriptions and actions', () => {
    const content = `---
playbook: true
name: Detailed Step Playbook
---
steps:
  - name: Build
    description: Compile the TypeScript project
    action: |
      tsc --build
      echo "Build complete"
  - name: Test
    description: Run the test suite
    action: npm test -- --coverage
    timeout: 120
`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(true);
    expect(result.output).toContain('Compile the TypeScript project');
    expect(result.output).toContain('tsc --build');
  });

  it('handles step IDs when present', () => {
    const content = `---
playbook: true
name: ID Playbook
---
steps:
  - id: step-001
    name: First
    action: echo 1
  - id: step-002
    name: Second
    action: echo 2
`;
    const result = importManusPlaybook(content);
    expect(result.success).toBe(true);
    // IDs are preserved in step objects but display uses name
    const playbook = parseManusPlaybook(content);
    expect(playbook?.steps[0].id).toBe('step-001');
    expect(playbook?.steps[1].id).toBe('step-002');
  });
});