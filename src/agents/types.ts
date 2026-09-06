import type { Evidence } from '../tools/types.js';

export interface AgentResult {
  agent: 'payment-agent' | 'contract-agent' | 'progress-agent';
  summary: string;
  evidence: Evidence[];
}
