import type { JsonValue } from '@deepseek-ai/dsh-llm'

export type VerificationKind =
  | 'file_exists'
  | 'file_not_exists'
  | 'file_content_equals'
  | 'fact_equals'

export type VerificationSpec =
  | { kind: 'file_exists'; path: string }
  | { kind: 'file_not_exists'; path: string }
  | { kind: 'file_content_equals'; path: string; content: string }
  | { kind: 'fact_equals'; key: string; value: JsonValue }

export interface ContractCheck {
  description: string
  verifier?: VerificationSpec
}

export interface GoalContract {
  objective: string
  success: ContractCheck[]
  invariants: ContractCheck[]
  nonGoals: string[]
  requestedAuthority: {
    mutation: boolean
    network: boolean
    irreversible: boolean
  }
  requestedBudget: {
    maxToolCalls: number
    maxFailures: number
  }
}

export interface TrustedFact {
  key: string
  value: JsonValue
  source: string
  confidence: number
  observedAt: number
  validUntil?: number
  verifiedBy: string[]
  dependencies: string[]
  valid: boolean
}

export interface OpenTransaction {
  id: string
  tool: string
  path: string
  snapshotPath: string
  existedBefore: boolean
  openedAt: number
}

export interface ExternalEffect {
  id: string
  tool: string
  openedAt: number
  status: 'open' | 'resolved'
  resolution?: 'confirmed' | 'not-applied' | 'compensated'
}

export interface VerifiedControlState {
  contract: GoalContract | null
  facts: Record<string, TrustedFact>
  openTransactions: Record<string, OpenTransaction>
  externalEffects: Record<string, ExternalEffect>
  toolCalls: number
  failures: number
}

export const EMPTY_CONTROL_STATE: VerifiedControlState = {
  contract: null,
  facts: {},
  openTransactions: {},
  externalEffects: {},
  toolCalls: 0,
  failures: 0,
}
