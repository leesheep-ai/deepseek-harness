import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEventMap } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'
import { captureFileTransaction, FileTransactionLocks, rollbackFileTransaction } from './transaction.ts'
import type { Incident, OpenTransaction, VerifiedControlState } from './types.ts'
import { verifyChecks } from './verifier.ts'

export interface TransactionRuntimeConfig {
  mutationTools: readonly string[]
  cleanupTimeoutMs: number
}

function stateOf(ctx: Context, agent: Agent): VerifiedControlState {
  return ctx.sessionProjections.stateOf(agent.session, 'verified-control')
}

function appendState(agent: Agent, transform: (state: VerifiedControlState) => VerifiedControlState): VerifiedControlState {
  const next = transform(stateOf(agent.ctx, agent))
  agent.session.append('verified-control/snapshot', { state: structuredClone(next) } satisfies SessionEventMap['verified-control/snapshot'])
  return next
}

function withoutTransaction(state: VerifiedControlState, id: string): VerifiedControlState {
  const openTransactions = { ...state.openTransactions }
  delete openTransactions[id]
  return { ...state, openTransactions }
}

function incident(kind: Incident['kind'], message: string, tool?: string): Incident {
  return {
    id: `${kind}:${randomUUID()}`,
    kind,
    message,
    createdAt: Date.now(),
    ...(tool === undefined ? {} : { tool }),
    regressionEval: { name: `regression:${kind}`, assertion: `This trajectory must not reproduce: ${message}` },
  }
}

function markRollbackFailed(agent: Agent, tx: OpenTransaction, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  appendState(agent, state => ({
    ...state,
    openTransactions: { ...state.openTransactions, [tx.id]: { ...tx, status: 'rollback-failed', reason } },
    incidents: [...state.incidents, incident('rollback-failure', reason, tx.tool)],
  }))
}

async function rollbackAndClose(ctx: Context, agent: Agent, tx: OpenTransaction, cleanupTimeoutMs: number, recovery: boolean): Promise<void> {
  await rollbackFileTransaction(ctx.fs, tx, cleanupTimeoutMs)
  appendState(agent, state => ({ ...withoutTransaction(state, tx.id), recoveries: state.recoveries + (recovery ? 1 : 0) }))
}

function transactionError(message: string, code: string): ToolExecutionResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, info: { name: 'VerifiedControlTransactionError', code } },
  }
}

function filePath(argumentsValue: unknown): string | undefined {
  if (typeof argumentsValue !== 'object' || argumentsValue === null || Array.isArray(argumentsValue)) return undefined
  const path = (argumentsValue as Record<string, unknown>).file_path
  return typeof path === 'string' && path.length > 0 ? path : undefined
}

async function recoverOpenTransactions(ctx: Context, agent: Agent, cleanupTimeoutMs: number): Promise<void> {
  const open = Object.values(stateOf(ctx, agent).openTransactions).filter(tx => tx.status === 'open')
  for (const tx of open) {
    try {
      await rollbackAndClose(ctx, agent, tx, cleanupTimeoutMs, true)
    } catch (error: unknown) {
      markRollbackFailed(agent, tx, error)
    }
  }
}

export function installTransactionRuntime(ctx: Context, config: TransactionRuntimeConfig): void {
  const locks = new FileTransactionLocks()

  ctx.on('agent/pre-step', async (payload, next) => {
    await recoverOpenTransactions(ctx, payload.agent, config.cleanupTimeoutMs)
    return next()
  })

  ctx.on('tools/execute', async (exec, next) => {
    const agent = exec.agent
    const path = filePath(exec.arguments)
    if (agent === undefined || path === undefined || !config.mutationTools.includes(exec.name)) return next()

    return locks.run(path, async () => {
      const tx = await captureFileTransaction(ctx.fs, {
        id: randomUUID(), tool: exec.name, path,
        cwd: agent.session.header.cwd, signal: exec.signal,
      })
      appendState(agent, state => ({ ...state, openTransactions: { ...state.openTransactions, [tx.id]: tx } }))

      let result: ToolExecutionResult
      try {
        result = await next()
      } catch (error: unknown) {
        try {
          await rollbackAndClose(ctx, agent, tx, config.cleanupTimeoutMs, false)
        } catch (rollbackError: unknown) {
          markRollbackFailed(agent, tx, rollbackError)
          throw new AggregateError([error, rollbackError], 'tool execution and verified-control rollback both failed')
        }
        throw error
      }

      if (result.isError) {
        try {
          await rollbackAndClose(ctx, agent, tx, config.cleanupTimeoutMs, false)
        } catch (error: unknown) {
          markRollbackFailed(agent, tx, error)
          return transactionError('tool failed and automatic rollback also failed; manual reconciliation is required', 'ROLLBACK_FAILED')
        }
        return result
      }

      const after = stateOf(ctx, agent)
      const verification = await verifyChecks(ctx, after, after.contract?.invariants ?? [], exec.signal)
      if (!verification.passed) {
        const reason = verification.results.filter(item => !item.passed).map(item => `${item.description}: ${item.reason}`).join('; ')
        try {
          await rollbackAndClose(ctx, agent, tx, config.cleanupTimeoutMs, false)
          appendState(agent, state => ({ ...state, incidents: [...state.incidents, incident('verification-failure', reason, exec.name)] }))
          return transactionError(`post-mutation invariant verification failed and mutation was rolled back: ${reason}`, 'INVARIANT_FAILED')
        } catch (error: unknown) {
          markRollbackFailed(agent, tx, error)
          return transactionError(`post-mutation invariant verification failed and rollback failed; manual reconciliation is required: ${reason}`, 'INVARIANT_AND_ROLLBACK_FAILED')
        }
      }

      appendState(agent, state => withoutTransaction(state, tx.id))
      return result
    })
  })
}
