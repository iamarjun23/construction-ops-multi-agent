export type QuestionType = 'payment_only' | 'progress_only' | 'contract_only' | 'compound';

export interface EvalQuestion {
  id: string;
  type: QuestionType;
  question: string;
  project: string;
  /** Which specialist(s) a correct answer must actually draw on. */
  expectedSpecialists: ('payment' | 'contract' | 'progress')[];
  /** Ground-truth facts pulled straight from the seeded DB (payment_only / progress_only / compound). */
  facts?: Record<string, unknown>;
  /** Key facts a correct answer should state, for contract_only / compound questions the judge grounds against. */
  hints?: string[];
  /** Only meaningful for compound questions: is there a genuine tension the answer should surface? */
  expectedConflict?: boolean;
}
