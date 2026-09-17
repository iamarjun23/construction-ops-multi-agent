export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

export interface AccessContext {
  userId: string;
  role: 'admin' | 'project_manager' | 'contractor';
  projectId: string;
  allowedZoneIds: string[] | 'all';
}

export interface Evidence {
  sourceId: string;
  sourceType: 'row' | 'chunk';
  content: string;
  /** Which domain this evidence came from — lets the Phase 5 eval harness measure evidence-source coverage. */
  specialist: 'payment' | 'contract' | 'progress';
}

// SPEC.md §8 tool schemas, plus ProgressLookupInput (implied by the Progress
// Agent's responsibility but not spelled out as a named type in the spec).

export interface VectorSearchInput {
  query: string;
  documentType?: 'contract' | 'policy';
  projectId: string;
  topK?: number;
}

export interface PaymentLookupInput {
  intent: 'payment_status' | 'milestone_status';
  projectId: string;
  zoneLabel?: string;
  milestoneName?: string;
}

export interface ProgressLookupInput {
  projectId: string;
  zoneLabel?: string;
  milestoneName?: string;
}
