import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { GoalContract, VerificationSpec } from './types.ts'

export function parseVerificationSpec(value: unknown, label = 'verifier'): VerificationSpec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  const raw = value as Record<string, unknown>
  if (raw.kind === 'file_exists' || raw.kind === 'file_not_exists') {
    if (typeof raw.path !== 'string' || raw.path.trim().length === 0) throw new TypeError(`${label} requires path`)
    return { kind: raw.kind, path: raw.path }
  }
  if (raw.kind === 'file_content_equals' || raw.kind === 'file_contains') {
    if (typeof raw.path !== 'string' || typeof raw.content !== 'string') throw new TypeError(`${label} requires path and content`)
    return { kind: raw.kind, path: raw.path, content: raw.content }
  }
  if (raw.kind === 'fact_equals') {
    if (typeof raw.key !== 'string' || raw.key.trim().length === 0 || !Object.hasOwn(raw, 'value')) throw new TypeError(`${label} requires key and value`)
    return { kind: 'fact_equals', key: raw.key, value: raw.value as JsonValue }
  }
  if (raw.kind === 'command_succeeds') {
    if (typeof raw.command !== 'string' || raw.command.trim().length === 0) throw new TypeError(`${label} requires command`)
    if (raw.workdir !== undefined && typeof raw.workdir !== 'string') throw new TypeError(`${label}.workdir must be a string`)
    if (raw.timeoutMs !== undefined && (!Number.isSafeInteger(raw.timeoutMs) || (raw.timeoutMs as number) < 1)) throw new TypeError(`${label}.timeoutMs must be a positive safe integer`)
    return { kind: 'command_succeeds', command: raw.command, ...(raw.workdir === undefined ? {} : { workdir: raw.workdir }), ...(raw.timeoutMs === undefined ? {} : { timeoutMs: raw.timeoutMs as number }) }
  }
  throw new TypeError(`${label} has unsupported kind`)
}

export function parseContract(value: unknown): GoalContract {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('contract must be an object')
  const raw = value as Record<string, unknown>
  if (typeof raw.objective !== 'string' || raw.objective.trim().length === 0) throw new TypeError('contract.objective must be non-empty')
  if (!Array.isArray(raw.success) || raw.success.length === 0) throw new TypeError('contract.success must be a non-empty array')
  if (!Array.isArray(raw.invariants) || !Array.isArray(raw.nonGoals)) throw new TypeError('contract.invariants/nonGoals must be arrays')
  if (!raw.nonGoals.every(item => typeof item === 'string')) throw new TypeError('contract.nonGoals must contain strings')
  const authority = raw.requestedAuthority
  const budget = raw.requestedBudget
  if (typeof authority !== 'object' || authority === null || Array.isArray(authority)) throw new TypeError('contract.requestedAuthority must be an object')
  if (typeof budget !== 'object' || budget === null || Array.isArray(budget)) throw new TypeError('contract.requestedBudget must be an object')
  const a = authority as Record<string, unknown>
  const b = budget as Record<string, unknown>
  for (const key of ['mutation', 'network', 'irreversible'] as const) if (typeof a[key] !== 'boolean') throw new TypeError(`contract.requestedAuthority.${key} must be boolean`)
  if (a.delegation !== undefined && typeof a.delegation !== 'boolean') throw new TypeError('contract.requestedAuthority.delegation must be boolean')
  if (!Number.isSafeInteger(b.maxToolCalls) || (b.maxToolCalls as number) < 1 || !Number.isSafeInteger(b.maxFailures) || (b.maxFailures as number) < 0) throw new TypeError('contract budgets are invalid')
  const optionalBudget = (key: 'maxDelegations' | 'maxDurationMs' | 'maxRepeatedToolCalls', min: number): number | undefined => {
    const candidate = b[key]
    if (candidate === undefined) return undefined
    if (!Number.isSafeInteger(candidate) || (candidate as number) < min) throw new TypeError(`contract.requestedBudget.${key} is invalid`)
    return candidate as number
  }
  const parseChecks = (items: unknown[], prefix: string): GoalContract['success'] => items.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new TypeError(`${prefix}[${index}] must be an object`)
    const check = item as Record<string, unknown>
    if (typeof check.description !== 'string' || check.description.trim().length === 0) throw new TypeError(`${prefix}[${index}] needs description`)
    return { description: check.description, ...(check.verifier === undefined ? {} : { verifier: parseVerificationSpec(check.verifier, `${prefix}[${index}].verifier`) }) }
  })
  const maxDelegations = optionalBudget('maxDelegations', 0)
  const maxDurationMs = optionalBudget('maxDurationMs', 1)
  const maxRepeatedToolCalls = optionalBudget('maxRepeatedToolCalls', 1)
  return {
    objective: raw.objective.trim(), success: parseChecks(raw.success, 'contract.success'), invariants: parseChecks(raw.invariants, 'contract.invariants'), nonGoals: raw.nonGoals as string[],
    requestedAuthority: { mutation: a.mutation as boolean, network: a.network as boolean, irreversible: a.irreversible as boolean, ...(a.delegation === undefined ? {} : { delegation: a.delegation as boolean }) },
    requestedBudget: { maxToolCalls: b.maxToolCalls as number, maxFailures: b.maxFailures as number, ...(maxDelegations === undefined ? {} : { maxDelegations }), ...(maxDurationMs === undefined ? {} : { maxDurationMs }), ...(maxRepeatedToolCalls === undefined ? {} : { maxRepeatedToolCalls }) },
  }
}
