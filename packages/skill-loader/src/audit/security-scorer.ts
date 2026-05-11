/**
 * Zero-Trust Audit (ZTA) Security Scorer
 *
 * Calculates security scores (0-100) for skills based on multiple security dimensions.
 * Part of the skill marketplace trust infrastructure (T-012).
 *
 * Scoring Rules:
 * - Start at 100, subtract penalties based on severity
 * - Critical: -30, High: -15, Medium: -5, Low: -1
 *
 * Recommendation Thresholds:
 * - 80-100: 'approve' (green, can be listed)
 * - 60-79: 'review' (yellow, needs manual review)
 * - 0-59: 'reject' (red, not allowed on marketplace)
 */

import type { IssueSeverity } from './auditor-types.js';

// ============================================================================
// Types
// ============================================================================

export interface SecurityFlag {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  location: string;  // line number or code section
  description: string;
  suggestion: string;
}

export interface SecurityScore {
  skillId: string;
  overall: number;        // 0-100
  breakdown: {
    networkSafety: number;      // e.g., no exfiltration URLs
    execSafety: number;        // no subprocess execution
    dataIsolation: number;     // no hardcoded credentials
    inputValidation: number;   // sanitizes all inputs
    dependencySafety: number;  // no dangerous imports
  };
  flags: SecurityFlag[];
  recommendation: 'approve' | 'review' | 'reject';
  scoredAt: string;
}

// ============================================================================
// Constants
// ============================================================================

const SEVERITY_PENALTIES: Record<IssueSeverity, number> = {
  critical: 30,
  high: 15,
  medium: 5,
  low: 1,
};

const RECOMMENDATION_THRESHOLDS = {
  approve: 80,
  review: 60,
  // Below 60 is reject
} as const;

// ============================================================================
// Detection Patterns
// ============================================================================

/**
 * Network safety patterns
 * Detects: hardcoded IPs, suspicious URLs, DNS exfiltration attempts
 */
const NETWORK_PATTERNS = {
  // Hardcoded IPv4 addresses (excluding common safe ones)
  ipv4Addresses: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b(?!\s*[,:]\s*(?:localhost|127\.0\.0\.1|0\.0\.0\.0))/g,

  // Hardcoded IPv6 addresses
  ipv6Addresses: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:|\b(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}/g,

  // Suspicious DNS patterns - long random subdomains (DNS exfiltration indicator)
  dnsExfiltration: /\b[a-z0-9]{20,}\.(?:com|net|org|io|xyz|info|biz)\b/gi,

  // Base64 in subdomain (data exfiltration)
  base64Subdomains: /\b[a-zA-Z0-9+/]{20,}@/g,

  // External IP lookup services
  externalIpServices: /api\.ipify|ifconfig\.me|whatismyip|ipecho|checkip\.dyndns/i,

  // Suspicious data transmission URLs
  dataExfilUrls: /exfil|exfiltrate|dataout|senddata|c2\.|gator\.logger/i,

  // Hardcoded external URLs (not localhost/dev)
  hardcodedExternalUrls: /https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
};

/**
 * Execution safety patterns
 * Detects: eval, exec, spawn, subprocess execution
 */
const EXEC_PATTERNS = {
  // Direct eval usage
  eval: /\beval\s*\(/,

  // Function constructor as eval alternative
  newFunction: /new\s+Function\s*\(/,

  // Indirect eval via (0,eval) or similar patterns
  indirectEval: /\(0,\s*eval\)\s*\(/,

  // VM module eval
  vmRunIn: /vm\.runIn(?:NewContext|Context|Script)/i,

  // child_process spawn
  childProcessSpawn: /child_process\.spawn\s*\(/,

  // child_process exec
  childProcessExec: /child_process\.exec\s*\(/,

  // child_process execFile
  childProcessExecFile: /child_process\.execFile\s*\(/,

  // spawnSync/execSync
  spawnSync: /spawnSync\s*\(/,

  // execSync
  execSync: /execSync\s*\(/,

  // require child_process with spawn/exec
  requireChildProcessSpawn: /require\s*\(\s*['"]child_process['"]\s*\)\.spawn/i,

  requireChildProcessExec: /require\s*\(\s*['"]child_process['"]\s*\)\.exec/i,

  // Shell command execution via template literals
  shellExec: /\$\{.*\}/,
};

/**
 * Data isolation patterns
 * Detects: hardcoded passwords, API keys, tokens, credentials
 */
const DATA_PATTERNS = {
  // Hardcoded passwords (various languages)
  hardcodedPasswords: /(?:password|passwd|pwd|pass)\s*[=:]\s*['"][^'"]+['"]/gi,

  // Hardcoded API keys (common patterns)
  hardcodedApiKeys: /(?:api[_-]?key|apikey|api[_-]?token|secret[_-]?key)\s*[=:]\s*['"][a-zA-Z0-9_-]{20,}['"]/gi,

  // Hardcoded bearer tokens
  bearerTokens: /bearer\s+[a-zA-Z0-9_-]{20,}/gi,

  // Hardcoded OAuth tokens
  oauthTokens: /oauth[_-]?token\s*[=:]\s*['"][a-zA-Z0-9_-]{20,}['"]/gi,

  // AWS keys
  awsKeys: /(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|aws_access_key|aws_secret)\s*[=:]\s*['"][A-Z0-9]{20,}['"]/gi,

  // Private keys (RSA, etc.)
  privateKeys: /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH)?\s*PRIVATE\s+KEY-----/,

  // GitHub tokens
  githubTokens: /gh[pousr]_[a-zA-Z0-9]{36,}/g,

  // Generic secret patterns
  genericSecrets: /(?:secret|token|credential|auth)\s*[=:]\s*['"][a-zA-Z0-9+/=]{40,}['"]/gi,

  // Database connection strings with passwords
  dbConnectionStrings: /(?:mysql|postgres|postgres|mongodb):\/\/[^:]+:[^@]+@/gi,
};

/**
 * Input validation patterns
 * Detects: unsanitized user inputs passed to system functions
 */
const INPUT_PATTERNS = {
  // InnerHTML/DangerouslySetInnerHTML (XSS)
  innerHtml: /\.innerHTML\s*=|dangerouslySetInnerHTML/i,

  // document.write
  documentWrite: /document\.write\s*\(/i,

  // eval on user input
  evalUserInput: /eval\s*\(\s*(?:req\.|process\.env|userInput|userData|body\.|params\.)/i,

  // SQL concatenation (SQL injection)
  sqlConcatenation: /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\+\s*['"]|execute\s*\(\s*['"].*\+|(?:query|sql)\s*[=:]\s*['"].*\$/gi,

  // Shell injection
  shellInjection: /\$\{.*(?:req\.|process\.|user|input|params|body)\.|`.*\$\{.*(?:req\.|process\.|user|input|params|body)\./gi,

  // Template literal with user input in shell context
  templateShellInjection: /\$\{.*\}\s*(?:\||2>|>>|&&|\|\|)/,

  // unsanitized input to fs operations
  unsanitizedFs: /(?:readFile|writeFile|readdir|unlink|rmdir)\s*\([^)]*(?:req\.|process\.|user|params|body)\./gi,
};

/**
 * Dependency safety patterns
 * Detects: dangerous imports (os, sys, socket, etc.)
 */
const DEPENDENCY_PATTERNS = {
  // Node.js dangerous modules
  childProcess: /require\s*\(\s*['"]child_process['"]\s*\)|from\s+['"]child_process['"]/i,

  // OS module (file system, process info)
  osModule: /require\s*\(\s*['"]os['"]\s*\)|from\s+['"]os['"]/i,

  // Sys/module (system info)
  sysModule: /require\s*\(\s*['"]sys['"]\s*\)|from\s+['"]sys['"]/i,

  // Socket module (network)
  socketModule: /require\s*\(\s*['"]socket['"]\s*\)|from\s+['"]socket['"]/i,

  // Net module (low-level networking)
  netModule: /require\s*\(\s*['"]net['"]\s*\)|from\s+['"]net['"]/i,

  // HTTP/HTTPS modules (network access)
  httpModule: /require\s*\(\s*['"]http['"]\s*\)|from\s+['"]http['"]/i,

  httpsModule: /require\s*\(\s*['"]https['"]\s*\)|from\s+['"]https['"]/i,

  // DNS module (DNS lookups, can be used for DNS exfil)
  dnsModule: /require\s*\(\s*['"]dns['"]\s*\)|from\s+['"]dns['"]/i,

  // Crypto module (for exfiltration encoding)
  cryptoModule: /require\s*\(\s*['"]crypto['"]\s*\)|from\s+['"]crypto['"]/i,

  // Shell module (command execution)
  shellModule: /require\s*\(\s*['"]shell['"]\s*\)|from\s+['"]shell['"]/i,

  // PyALLOWED modules (Python - os, sys, subprocess, socket)
  pyOsModule: /import\s+os\b/,

  pySysModule: /import\s+sys\b/,

  pySubprocessModule: /import\s+subprocess|from\s+subprocess\b/,

  pySocketModule: /import\s+socket|from\s+socket\b/,

  pyPickle: /import\s+pickle|from\s+pickle\b/,

  // Java Runtime exec
  javaRuntimeExec: /Runtime\.getRuntime\(\)\.exec\s*\(/i,

  // Java ProcessBuilder
  javaProcessBuilder: /new\s+ProcessBuilder\s*\(/i,

  // Ruby system/exec
  rubySystemExec: /\bsystem\s*\(|exec\s*\(|spawn\s*\(/i,
};

// ============================================================================
// Security Scorer Class
// ============================================================================

export interface ScorerConfig {
  skillId: string;
  content: string;
  language?: 'javascript' | 'typescript' | 'python' | 'java' | 'ruby' | 'unknown';
}

export class SecurityScorer {
  /**
   * Calculate the complete security score for a skill
   */
  score(config: ScorerConfig): SecurityScore {
    const { skillId, content, language = 'unknown' } = config;

    // Detect all security issues
    const networkFlags = this._detectNetworkIssues(content);
    const execFlags = this._detectExecIssues(content);
    const dataFlags = this._detectDataIsolationIssues(content);
    const inputFlags = this._detectInputValidationIssues(content);
    const depFlags = this._detectDependencyIssues(content, language);

    // Calculate individual category scores (start at 100, subtract penalties)
    const networkSafety = this._calculateCategoryScore(networkFlags);
    const execSafety = this._calculateCategoryScore(execFlags);
    const dataIsolation = this._calculateCategoryScore(dataFlags);
    const inputValidation = this._calculateCategoryScore(inputFlags);
    const dependencySafety = this._calculateCategoryScore(depFlags);

    // Combine all flags
    const allFlags: SecurityFlag[] = [
      ...networkFlags,
      ...execFlags,
      ...dataFlags,
      ...inputFlags,
      ...depFlags,
    ];

    // Calculate overall score (weighted average of categories)
    const overall = Math.round(
      (networkSafety + execSafety + dataIsolation + inputValidation + dependencySafety) / 5
    );

    // Determine recommendation based on thresholds
    const recommendation = this._getRecommendation(overall);

    return {
      skillId,
      overall,
      breakdown: {
        networkSafety,
        execSafety,
        dataIsolation,
        inputValidation,
        dependencySafety,
      },
      flags: allFlags,
      recommendation,
      scoredAt: new Date().toISOString(),
    };
  }

  /**
   * Calculate score for a single category
   */
  private _calculateCategoryScore(flags: SecurityFlag[]): number {
    const penalty = flags.reduce((sum, flag) => sum + SEVERITY_PENALTIES[flag.severity], 0);
    return Math.max(0, 100 - penalty);
  }

  /**
   * Determine recommendation based on overall score
   */
  private _getRecommendation(score: number): 'approve' | 'review' | 'reject' {
    if (score >= RECOMMENDATION_THRESHOLDS.approve) return 'approve';
    if (score >= RECOMMENDATION_THRESHOLDS.review) return 'review';
    return 'reject';
  }

  /**
   * Get line number for a match index
   */
  private _getLineForMatch(content: string, index: number): string {
    const before = content.slice(0, index);
    const lines = before.split('\n');
    const lineNum = lines.length;
    const lineContent = content.slice(index, index + 80).trim();
    return `line ${lineNum}: ${lineContent}`;
  }

  // =========================================================================
  // Detection Methods
  // =========================================================================

  private _detectNetworkIssues(content: string): SecurityFlag[] {
    const flags: SecurityFlag[] = [];

    // Detect hardcoded IPv4 addresses
    let match;
    const ipv4Regex = new RegExp(NETWORK_PATTERNS.ipv4Addresses.source, 'g');
    while ((match = ipv4Regex.exec(content)) !== null) {
      flags.push({
        severity: 'high',
        category: 'networkSafety',
        location: this._getLineForMatch(content, match.index),
        description: `Hardcoded IPv4 address detected: ${match[0]}`,
        suggestion: 'Use environment variables or configuration files for external endpoints. Avoid hardcoding IP addresses.',
      });
    }

    // Detect hardcoded IPv6 addresses
    const ipv6Regex = new RegExp(NETWORK_PATTERNS.ipv6Addresses.source, 'g');
    while ((match = ipv6Regex.exec(content)) !== null) {
      flags.push({
        severity: 'high',
        category: 'networkSafety',
        location: this._getLineForMatch(content, match.index),
        description: `Hardcoded IPv6 address detected: ${match[0]}`,
        suggestion: 'Use environment variables or configuration files for external endpoints.',
      });
    }

    // Detect DNS exfiltration patterns
    const dnsRegex = new RegExp(NETWORK_PATTERNS.dnsExfiltration.source, NETWORK_PATTERNS.dnsExfiltration.flags);
    while ((match = dnsRegex.exec(content)) !== null) {
      flags.push({
        severity: 'critical',
        category: 'networkSafety',
        location: this._getLineForMatch(content, match.index),
        description: `Suspicious DNS pattern (potential DNS exfiltration): ${match[0]}`,
        suggestion: 'Review this domain. Long random subdomains are commonly used in DNS exfiltration attacks.',
      });
    }

    // Detect base64 in subdomains
    const b64SubRegex = new RegExp(NETWORK_PATTERNS.base64Subdomains.source, NETWORK_PATTERNS.base64Subdomains.flags);
    while ((match = b64SubRegex.exec(content)) !== null) {
      flags.push({
        severity: 'critical',
        category: 'networkSafety',
        location: this._getLineForMatch(content, match.index),
        description: `Base64 encoded data in subdomain (potential data exfiltration): ${match[0]}`,
        suggestion: 'Review this pattern. Base64 in subdomains can indicate encoded data transmission.',
      });
    }

    // Detect external IP services
    const ipServicesRegex = new RegExp(NETWORK_PATTERNS.externalIpServices.source, NETWORK_PATTERNS.externalIpServices.flags);
    while ((match = ipServicesRegex.exec(content)) !== null) {
      flags.push({
        severity: 'medium',
        category: 'networkSafety',
        location: this._getLineForMatch(content, match.index),
        description: `External IP lookup service detected: ${match[0]}`,
        suggestion: 'Review if this IP lookup is necessary and secure.',
      });
    }

    // Detect data exfiltration URLs
    const exfilRegex = new RegExp(NETWORK_PATTERNS.dataExfilUrls.source, NETWORK_PATTERNS.dataExfilUrls.flags);
    while ((match = exfilRegex.exec(content)) !== null) {
      flags.push({
        severity: 'critical',
        category: 'networkSafety',
        location: this._getLineForMatch(content, match.index),
        description: `Suspicious data exfiltration URL pattern: ${match[0]}`,
        suggestion: 'Review this URL. Suspicious keywords may indicate data exfiltration.',
      });
    }

    // Detect hardcoded external URLs
    const urlRegex = new RegExp(NETWORK_PATTERNS.hardcodedExternalUrls.source, NETWORK_PATTERNS.hardcodedExternalUrls.flags);
    while ((match = urlRegex.exec(content)) !== null) {
      flags.push({
        severity: 'low',
        category: 'networkSafety',
        location: this._getLineForMatch(content, match.index),
        description: `Hardcoded external URL detected: ${match[0]}`,
        suggestion: 'Consider using environment variables for external URLs.',
      });
    }

    return flags;
  }

  private _detectExecIssues(content: string): SecurityFlag[] {
    const flags: SecurityFlag[] = [];

    const execChecks: Array<{pattern: RegExp; severity: 'critical' | 'high'; description: string}> = [
      { pattern: EXEC_PATTERNS.eval, severity: 'critical', description: 'Direct eval() usage detected' },
      { pattern: EXEC_PATTERNS.newFunction, severity: 'critical', description: 'new Function() usage detected (eval alternative)' },
      { pattern: EXEC_PATTERNS.indirectEval, severity: 'critical', description: 'Indirect eval pattern (0,eval) detected' },
      { pattern: EXEC_PATTERNS.vmRunIn, severity: 'critical', description: 'vm.runIn* usage detected' },
      { pattern: EXEC_PATTERNS.childProcessSpawn, severity: 'critical', description: 'child_process.spawn() detected' },
      { pattern: EXEC_PATTERNS.childProcessExec, severity: 'critical', description: 'child_process.exec() detected' },
      { pattern: EXEC_PATTERNS.childProcessExecFile, severity: 'critical', description: 'child_process.execFile() detected' },
      { pattern: EXEC_PATTERNS.spawnSync, severity: 'critical', description: 'spawnSync() detected' },
      { pattern: EXEC_PATTERNS.execSync, severity: 'critical', description: 'execSync() detected' },
      { pattern: EXEC_PATTERNS.requireChildProcessSpawn, severity: 'critical', description: 'require("child_process").spawn detected' },
      { pattern: EXEC_PATTERNS.requireChildProcessExec, severity: 'critical', description: 'require("child_process").exec detected' },
      { pattern: EXEC_PATTERNS.shellExec, severity: 'high', description: 'Shell execution via template literals detected' },
    ];

    for (const check of execChecks) {
      const match = content.match(check.pattern);
      if (match) {
        flags.push({
          severity: check.severity,
          category: 'execSafety',
          location: this._getLineForMatch(content, match.index!),
          description: check.description + `: ${match[0]}`,
          suggestion: 'Avoid dynamic code execution. Use safer alternatives for the intended functionality.',
        });
      }
    }

    return flags;
  }

  private _detectDataIsolationIssues(content: string): SecurityFlag[] {
    const flags: SecurityFlag[] = [];

    const dataChecks: Array<{pattern: RegExp; severity: 'critical' | 'high'; description: string}> = [
      { pattern: DATA_PATTERNS.hardcodedPasswords, severity: 'critical', description: 'Hardcoded password detected' },
      { pattern: DATA_PATTERNS.hardcodedApiKeys, severity: 'critical', description: 'Hardcoded API key detected' },
      { pattern: DATA_PATTERNS.bearerTokens, severity: 'critical', description: 'Hardcoded bearer token detected' },
      { pattern: DATA_PATTERNS.oauthTokens, severity: 'critical', description: 'Hardcoded OAuth token detected' },
      { pattern: DATA_PATTERNS.awsKeys, severity: 'critical', description: 'AWS access key detected' },
      { pattern: DATA_PATTERNS.privateKeys, severity: 'critical', description: 'Private key detected' },
      { pattern: DATA_PATTERNS.githubTokens, severity: 'high', description: 'GitHub token detected' },
      { pattern: DATA_PATTERNS.genericSecrets, severity: 'high', description: 'Generic secret/token detected' },
      { pattern: DATA_PATTERNS.dbConnectionStrings, severity: 'high', description: 'Database connection string with credentials detected' },
    ];

    for (const check of dataChecks) {
      const regex = new RegExp(check.pattern.source, check.pattern.flags || 'gi');
      let match;
      while ((match = regex.exec(content)) !== null) {
        flags.push({
          severity: check.severity,
          category: 'dataIsolation',
          location: this._getLineForMatch(content, match.index),
          description: check.description + `: ${match[0].slice(0, 60)}${match[0].length > 60 ? '...' : ''}`,
          suggestion: 'Use environment variables or secure credential storage instead of hardcoding secrets.',
        });
      }
    }

    return flags;
  }

  private _detectInputValidationIssues(content: string): SecurityFlag[] {
    const flags: SecurityFlag[] = [];

    const inputChecks: Array<{pattern: RegExp; severity: 'critical' | 'high' | 'medium'; description: string}> = [
      { pattern: INPUT_PATTERNS.innerHtml, severity: 'high', description: 'innerHTML assignment detected (XSS risk)' },
      { pattern: INPUT_PATTERNS.documentWrite, severity: 'high', description: 'document.write() detected (XSS risk)' },
      { pattern: INPUT_PATTERNS.evalUserInput, severity: 'critical', description: 'eval() with user input detected' },
      { pattern: INPUT_PATTERNS.sqlConcatenation, severity: 'critical', description: 'SQL concatenation detected (SQL injection risk)' },
      { pattern: INPUT_PATTERNS.shellInjection, severity: 'critical', description: 'Shell injection risk detected' },
      { pattern: INPUT_PATTERNS.templateShellInjection, severity: 'high', description: 'Template literal with shell execution detected' },
      { pattern: INPUT_PATTERNS.unsanitizedFs, severity: 'medium', description: 'Unsanitized input to filesystem operations detected' },
    ];

    for (const check of inputChecks) {
      const match = content.match(check.pattern);
      if (match) {
        flags.push({
          severity: check.severity,
          category: 'inputValidation',
          location: this._getLineForMatch(content, match.index!),
          description: check.description + `: ${match[0]}`,
          suggestion: 'Sanitize and validate all user inputs before using them in system operations.',
        });
      }
    }

    return flags;
  }

  private _detectDependencyIssues(content: string, language: string): SecurityFlag[] {
    const flags: SecurityFlag[] = [];

    const depChecks: Array<{pattern: RegExp; severity: 'critical' | 'high' | 'medium'; description: string}> = [
      { pattern: DEPENDENCY_PATTERNS.childProcess, severity: 'high', description: 'child_process module imported' },
      { pattern: DEPENDENCY_PATTERNS.osModule, severity: 'medium', description: 'os module imported (system info exposure)' },
      { pattern: DEPENDENCY_PATTERNS.sysModule, severity: 'medium', description: 'sys module imported' },
      { pattern: DEPENDENCY_PATTERNS.socketModule, severity: 'high', description: 'socket module imported' },
      { pattern: DEPENDENCY_PATTERNS.netModule, severity: 'high', description: 'net module imported (low-level networking)' },
      { pattern: DEPENDENCY_PATTERNS.httpModule, severity: 'medium', description: 'http module imported (network access)' },
      { pattern: DEPENDENCY_PATTERNS.httpsModule, severity: 'medium', description: 'https module imported (network access)' },
      { pattern: DEPENDENCY_PATTERNS.dnsModule, severity: 'high', description: 'dns module imported (DNS exfiltration risk)' },
      { pattern: DEPENDENCY_PATTERNS.cryptoModule, severity: 'medium', description: 'crypto module imported (encoding for exfil)' },
    ];

    // Language-specific checks
    if (language === 'python') {
      const pyChecks: Array<{pattern: RegExp; severity: 'critical' | 'high' | 'medium'; description: string}> = [
        { pattern: DEPENDENCY_PATTERNS.pyOsModule, severity: 'medium', description: 'os module imported' },
        { pattern: DEPENDENCY_PATTERNS.pySysModule, severity: 'medium', description: 'sys module imported' },
        { pattern: DEPENDENCY_PATTERNS.pySubprocessModule, severity: 'high', description: 'subprocess module imported' },
        { pattern: DEPENDENCY_PATTERNS.pySocketModule, severity: 'high', description: 'socket module imported' },
        { pattern: DEPENDENCY_PATTERNS.pyPickle, severity: 'critical', description: 'pickle module imported (deserialization risk)' },
      ];
      depChecks.push(...pyChecks);
    } else if (language === 'java') {
      const javaChecks: Array<{pattern: RegExp; severity: 'critical' | 'high'; description: string}> = [
        { pattern: DEPENDENCY_PATTERNS.javaRuntimeExec, severity: 'critical', description: 'Runtime.exec() detected' },
        { pattern: DEPENDENCY_PATTERNS.javaProcessBuilder, severity: 'high', description: 'ProcessBuilder detected' },
      ];
      depChecks.push(...javaChecks);
    } else if (language === 'ruby') {
      const rubyChecks: Array<{pattern: RegExp; severity: 'high'; description: string}> = [
        { pattern: DEPENDENCY_PATTERNS.rubySystemExec, severity: 'high', description: 'system/exec/spawn detected' },
      ];
      depChecks.push(...rubyChecks);
    } else if (language === 'javascript' || language === 'typescript') {
      const jsChecks: Array<{pattern: RegExp; severity: 'high' | 'medium'; description: string}> = [
        { pattern: DEPENDENCY_PATTERNS.shellModule, severity: 'high', description: 'shell module imported' },
      ];
      depChecks.push(...jsChecks);
    }

    for (const check of depChecks) {
      const match = content.match(check.pattern);
      if (match) {
        flags.push({
          severity: check.severity,
          category: 'dependencySafety',
          location: this._getLineForMatch(content, match.index!),
          description: check.description + `: ${match[0]}`,
          suggestion: 'Review if this module is necessary. Consider using safer alternatives.',
        });
      }
    }

    return flags;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick score calculation for a skill
 */
export function scoreSecurity(config: ScorerConfig): SecurityScore {
  const scorer = new SecurityScorer();
  return scorer.score(config);
}