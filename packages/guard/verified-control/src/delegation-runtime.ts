import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { appendState, stateOf } from './runtime-state.ts'
import type { DelegationContract, VerifiedControlState } from './types.ts'

export interface DelegationRuntimeConfig { delegationTools: readonly string[] }

export function prepareDelegation(state: VerifiedControlState, input: { objective: string; expectedEvidence: string[]; resourceScope: string[] }): { state: VerifiedControlState; delegation: DelegationContract } {
  if (state.contract === null) throw new Error('a Goal Contract is required before preparing delegation')
  if (input.objective.trim().length === 0) throw new Error('delegation objective must be non-empty')
  if (input.expectedEvidence.length === 0) throw new Error('delegation expectedEvidence must be non-empty')
  const delegation: DelegationContract = { id: randomUUID(), objective: input.objective.trim(), expectedEvidence: [...input.expectedEvidence], resourceScope: [...input.resourceScope], createdAt: Date.now(), status: 'prepared' }
  return { state: { ...state, delegationContracts: { ...state.delegationContracts, [delegation.id]: delegation } }, delegation }
}

export function hasPreparedDelegation(state: VerifiedControlState): boolean { return Object.values(state.delegationContracts).some(item => item.status === 'prepared') }
function oldestPrepared(state: VerifiedControlState): DelegationContract | undefined { return Object.values(state.delegationContracts).filter(item => item.status === 'prepared').sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0] }
function claimDelegation(agent: Agent, tool: string, callId: string): DelegationContract {
  let claimed: DelegationContract | undefined
  appendState(agent, state => {
    const prepared = oldestPrepared(state)
    if (prepared === undefined) return state
    claimed = { ...prepared, status: 'running', tool, callId }
    return { ...state, delegations: state.delegations + 1, delegationContracts: { ...state.delegationContracts, [prepared.id]: claimed } }
  })
  if (claimed === undefined) throw new Error('delegation requires an unconsumed control_prepare_delegation contract')
  return claimed
}
function settleDelegation(agent: Agent, id: string, status: 'dispatched' | 'completed' | 'failed', error?: string): void {
  appendState(agent, state => { const current = state.delegationContracts[id]; if (current === undefined) return state; return { ...state, delegationContracts: { ...state.delegationContracts, [id]: { ...current, status, ...(error === undefined ? {} : { error }) } } } })
}
function isBackground(value: unknown): boolean { return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).run_in_background === true }
function delegationError(message: string): ToolExecutionResult { return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true, error: { message, info: { name: 'VerifiedControlDelegationError', code: 'DELEGATION_CONTRACT_REQUIRED' } } } }

export function installDelegationRuntime(ctx: Context, config: DelegationRuntimeConfig): void {
  if (config.delegationTools.length === 0) return
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.agent === undefined || !config.delegationTools.includes(exec.name)) return next()
    let delegation: DelegationContract
    try { delegation = claimDelegation(exec.agent, exec.name, String(exec.callId)) } catch (error: unknown) { return delegationError(error instanceof Error ? error.message : String(error)) }
    let result: ToolExecutionResult
    try { result = await next() } catch (error: unknown) { settleDelegation(exec.agent, delegation.id, 'failed', error instanceof Error ? error.message : String(error)); throw error }
    if (result.isError) settleDelegation(exec.agent, delegation.id, 'failed', result.error.message)
    else settleDelegation(exec.agent, delegation.id, isBackground(exec.arguments) ? 'dispatched' : 'completed')
    return result
  })
}

export function delegationState(ctx: Context, agent: Agent): VerifiedControlState { return stateOf(ctx, agent) }
