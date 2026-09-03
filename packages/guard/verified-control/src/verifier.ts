import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-shell'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { validFact } from './state.ts'
import type { ContractCheck, GoalContract, VerificationSpec, VerifiedControlState } from './types.ts'

export interface CheckResult {
  passed: boolean
  description: string
  reason: string
}

export interface ContractVerification {
  passed: boolean
  coverage: number
  results: CheckResult[]
}

/** Deployment-owned policy for verifier operations that can execute code. */
export interface VerifierPolicy {
  /** Exact shell command strings trusted to run as deterministic verifiers. */
  commandAllowlist: readonly string[]
}

export const DEFAULT_VERIFIER_POLICY: VerifierPolicy = Object.freeze({ commandAllowlist: Object.freeze([]) })

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonEqual(value, right[index] as JsonValue))
  }
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && jsonEqual(left[key] as JsonValue, right[key] as JsonValue))
}

/** Explain a deployment-policy rejection for one verifier, if any. */
export function verifierPolicyIssue(spec: VerificationSpec, policy: VerifierPolicy): string | undefined {
  if (spec.kind !== 'command_succeeds') return undefined
  if (spec.workdir !== undefined) {
    return 'command_succeeds workdir overrides are disabled; encode any required directory in a deployment-allowlisted command'
  }
  if (!policy.commandAllowlist.includes(spec.command)) {
    return `command_succeeds is disabled for non-allowlisted command ${JSON.stringify(spec.command)}`
  }
  return undefined
}

/** Reject an impossible or unauthorized Goal Contract before work begins. */
export function contractVerifierPolicyIssue(contract: GoalContract, policy: VerifierPolicy): string | undefined {
  for (const [scope, checks] of [['success', contract.success], ['invariants', contract.invariants]] as const) {
    for (let index = 0; index < checks.length; index += 1) {
      const verifier = checks[index]?.verifier
      if (verifier === undefined) continue
      const issue = verifierPolicyIssue(verifier, policy)
      if (issue !== undefined) return `contract.${scope}[${index}]: ${issue}`
    }
  }
  return undefined
}

export async function verifySpec(
  ctx: Context,
  state: VerifiedControlState,
  spec: VerificationSpec,
  signal?: AbortSignal,
  policy: VerifierPolicy = DEFAULT_VERIFIER_POLICY,
): Promise<{ passed: boolean; reason: string }> {
  if (spec.kind === 'fact_equals') {
    const fact = state.facts[spec.key]
    if (!validFact(fact)) return { passed: false, reason: `fact ${spec.key} is missing, invalid, or stale` }
    if (fact.verifiedBy.length === 0) return { passed: false, reason: `fact ${spec.key} has no independent verifier` }
    const passed = jsonEqual(fact.value, spec.value)
    return { passed, reason: passed ? 'trusted fact matched' : 'trusted fact did not match' }
  }

  if (spec.kind === 'command_succeeds') {
    const policyIssue = verifierPolicyIssue(spec, policy)
    if (policyIssue !== undefined) return { passed: false, reason: policyIssue }
    const shell = ctx.get('shell')
    if (shell === undefined) return { passed: false, reason: 'shell verifier is unavailable in this composition' }
    const resolved = shell.resolve({
      command: spec.command,
      ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
      ...(signal === undefined ? {} : { signal }),
    })
    const result = await shell.run(resolved)
    const passed = result.exitCode === 0 && !result.timedOut && !result.aborted
    return { passed, reason: passed ? 'allowlisted command exited successfully' : `allowlisted command failed with exit ${String(result.exitCode)}` }
  }

  const target = await ctx.fs.resolve(spec.path, signal === undefined ? undefined : { signal })
  const info = await ctx.fs.stat(target, signal)
  if (spec.kind === 'file_exists') {
    return { passed: info?.type === 'file', reason: info?.type === 'file' ? 'file exists' : 'file does not exist as a regular file' }
  }
  if (spec.kind === 'file_not_exists') {
    return { passed: info === undefined, reason: info === undefined ? 'file is absent' : 'file exists' }
  }
  if (info?.type !== 'file') return { passed: false, reason: 'file does not exist as a regular file' }
  const content = await ctx.fs.readText(target, signal)
  if (spec.kind === 'file_contains') {
    const passed = content.includes(spec.content)
    return { passed, reason: passed ? 'file contains expected text' : 'file does not contain expected text' }
  }
  const passed = content === spec.content
  return { passed, reason: passed ? 'file content matched' : 'file content did not match' }
}

export async function verifyChecks(
  ctx: Context,
  state: VerifiedControlState,
  checks: ContractCheck[],
  signal?: AbortSignal,
  policy: VerifierPolicy = DEFAULT_VERIFIER_POLICY,
): Promise<ContractVerification> {
  const results: CheckResult[] = []
  let machineVerifiable = 0
  for (const check of checks) {
    if (check.verifier === undefined) {
      results.push({ passed: false, description: check.description, reason: 'no deterministic verifier declared' })
      continue
    }
    machineVerifiable += 1
    try {
      const result = await verifySpec(ctx, state, check.verifier, signal, policy)
      results.push({ ...result, description: check.description })
    } catch (error: unknown) {
      results.push({ passed: false, description: check.description, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  const coverage = checks.length === 0 ? 1 : machineVerifiable / checks.length
  return {
    passed: checks.length === 0 ? true : coverage === 1 && results.every(result => result.passed),
    coverage,
    results,
  }
}
