import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { ContractCheck, VerificationSpec, VerifiedControlState } from './types.ts'

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

async function verifySpec(
  ctx: Context,
  state: VerifiedControlState,
  spec: VerificationSpec,
  signal?: AbortSignal,
): Promise<{ passed: boolean; reason: string }> {
  if (spec.kind === 'fact_equals') {
    const fact = state.facts[spec.key]
    if (fact === undefined || !fact.valid) return { passed: false, reason: `fact ${spec.key} is missing or invalid` }
    if (fact.validUntil !== undefined && fact.validUntil <= Date.now()) return { passed: false, reason: `fact ${spec.key} is stale` }
    if (fact.verifiedBy.length === 0) return { passed: false, reason: `fact ${spec.key} has no independent verifier` }
    return {
      passed: isDeepStrictEqual(fact.value, spec.value),
      reason: isDeepStrictEqual(fact.value, spec.value) ? 'trusted fact matched' : 'trusted fact did not match',
    }
  }

  const target = await ctx.fs.resolve(spec.path, { signal })
  const info = await ctx.fs.stat(target, signal)
  if (spec.kind === 'file_exists') {
    return { passed: info?.type === 'file', reason: info?.type === 'file' ? 'file exists' : 'file does not exist as a regular file' }
  }
  if (spec.kind === 'file_not_exists') {
    return { passed: info === undefined, reason: info === undefined ? 'file is absent' : 'file exists' }
  }
  if (info?.type !== 'file') return { passed: false, reason: 'file does not exist as a regular file' }
  const content = await ctx.fs.readText(target, signal)
  return { passed: content === spec.content, reason: content === spec.content ? 'file content matched' : 'file content did not match' }
}

export async function verifyChecks(
  ctx: Context,
  state: VerifiedControlState,
  checks: ContractCheck[],
  signal?: AbortSignal,
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
      const result = await verifySpec(ctx, state, check.verifier, signal)
      results.push({ ...result, description: check.description })
    } catch (error: unknown) {
      results.push({ passed: false, description: check.description, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  const coverage = checks.length === 0 ? 1 : machineVerifiable / checks.length
  return { passed: checks.length > 0 && coverage === 1 && results.every(result => result.passed), coverage, results }
}
