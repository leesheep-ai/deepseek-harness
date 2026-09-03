import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export type VerificationSpec =
  | { kind: 'file_exists'; path: string }
  | { kind: 'file_not_exists'; path: string }
  | { kind: 'file_content_equals'; path: string; content: string }
  | { kind: 'file_contains'; path: string; content: string }
  | { kind: 'fact_equals'; key: string; value: JsonValue }
  | { kind: 'command_succeeds'; command: string; workdir?: string; timeoutMs?: number }

export interface ContractCheck {
  description: string
  verifier?: VerificationSpec
}

export interface GoalContract {
  objective: string
  success: ContractCheck[]
  invariants: ContractCheck[]
  nonGoals: string[]
  requestedAuthority: { mutation: boolean; network: boolean; irreversible: boolean; delegation?: boolean }
  requestedBudget: { maxToolCalls: number; maxFailures: number; maxDelegations?: number; maxDurationMs?: number; maxRepeatedToolCalls?: number }
}

export type FactOrigin = 'model' | 'tool' | 'human' | 'verifier'
export interface TrustedFact { key: string; value: JsonValue; origin: FactOrigin; source: string; confidence: number; observedAt: number; validUntil?: number; verifiedBy: string[]; dependencies: string[]; valid: boolean }
export type TransactionStatus = 'open' | 'rollback-failed'
export interface OpenTransaction { id: string; tool: string; path: string; displayPath: string; before: string | null; openedAt: number; status: TransactionStatus; workspaceRoot?: string; reason?: string }
export type ExternalEffectStatus = 'open' | 'review' | 'resolved'
export type ExternalResolution = 'confirmed' | 'not-applied' | 'compensated'
export interface ExternalEffect { id: string; tool: string; callId?: string; openedAt: number; status: ExternalEffectStatus; resolution?: ExternalResolution; detail?: string }
export type DelegationStatus = 'prepared' | 'running' | 'dispatched' | 'completed' | 'failed'
export interface DelegationContract { id: string; objective: string; expectedEvidence: string[]; resourceScope: string[]; createdAt: number; status: DelegationStatus; tool?: string; callId?: string; error?: string }
export type IncidentKind = 'tool-failure' | 'verification-failure' | 'rollback-failure' | 'external-effect-review' | 'budget-exhausted' | 'repetition-stall'
export interface Incident { id: string; kind: IncidentKind; message: string; createdAt: number; tool?: string; callId?: string; regressionEval: { name: string; assertion: string } }

export interface VerifiedControlState {
  contract: GoalContract | null
  facts: Record<string, TrustedFact>
  openTransactions: Record<string, OpenTransaction>
  externalEffects: Record<string, ExternalEffect>
  incidents: Incident[]
  toolCalls: number
  failures: number
  delegations: number
  delegationContracts: Record<string, DelegationContract>
  successfulTools: number
  consecutiveFailures: number
  lastTool: { signature: string | null; repeated: number }
  startedAt: number | null
  recoveries: number
}

export const EMPTY_CONTROL_STATE: VerifiedControlState = {
  contract: null, facts: {}, openTransactions: {}, externalEffects: {}, incidents: [],
  toolCalls: 0, failures: 0, delegations: 0, delegationContracts: {}, successfulTools: 0,
  consecutiveFailures: 0, lastTool: { signature: null, repeated: 0 }, startedAt: null, recoveries: 0,
}
