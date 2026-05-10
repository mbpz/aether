import type { TeamMember, TeamRole } from './team-orchestrator.js';

export interface CapabilityMatch {
  agentId: string;
  role: TeamRole;
  matchScore: number;
  reasoning: string;
}

export class TaskAnalyzer {
  analyze(task: string, members: TeamMember[]): CapabilityMatch[] {
    if (members.length === 0) return [];
    const taskLower = task.toLowerCase();
    const keywordMap: Record<string, TeamRole> = {
      'write': 'executor', 'code': 'executor', 'implement': 'executor', 'build': 'executor',
      'analyze': 'reviewer', 'review': 'reviewer', 'check': 'reviewer', 'audit': 'reviewer',
      'plan': 'planner', 'design': 'planner', 'strategy': 'planner',
      'research': 'generalist', 'find': 'generalist', 'search': 'generalist',
    };
    const scores = members.map(member => {
      let score = 50;
      const reasons: string[] = [];
      for (const [keyword, preferredRole] of Object.entries(keywordMap)) {
        if (taskLower.includes(keyword)) {
          if (member.role === preferredRole) {
            score += 30;
            reasons.push(`matches '${keyword}' → ${preferredRole}`);
          } else {
            score -= 10;
          }
        }
      }
      return { agentId: member.agentId, role: member.role, matchScore: Math.min(100, score), reasoning: reasons.length > 0 ? reasons.join(', ') : 'default assignment' } as CapabilityMatch;
    });
    scores.sort((a, b) => b.matchScore - a.matchScore);
    return scores;
  }

  splitTask(task: string, numParts: number): string[] {
    const sentences = task.split(/(?<=[.!?])\s+/).filter(s => s.trim());
    if (sentences.length <= numParts) return sentences.length > 0 ? sentences : [task];
    const parts: string[] = [];
    const perPart = Math.ceil(sentences.length / numParts);
    for (let i = 0; i < sentences.length; i += perPart) {
      const chunk = sentences.slice(i, i + perPart).join(' ');
      if (chunk.trim()) parts.push(chunk);
    }
    return parts.length > 0 ? parts : [task];
  }
}