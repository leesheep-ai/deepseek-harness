import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { TrustedFact, VerifiedControlState } from './types.ts'

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

export function validFact(fact: TrustedFact | undefined, now = Date.now()): fact is TrustedFact {
  return fact !== undefined && fact.valid && (fact.validUntil === undefined || fact.validUntil > now)
}

export function validFacts(state: VerifiedControlState, now = Date.now()): Record<string, TrustedFact> {
  return Object.fromEntries(Object.entries(state.facts).filter(([, fact]) => validFact(fact, now)))
}

export function publicFactValues(state: VerifiedControlState, now = Date.now()): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(validFacts(state, now)).map(([key, fact]) => [key, fact.value]))
}

function invalidateInto(facts: Record<string, TrustedFact>, key: string, seen: Set<string>): void {
  if (seen.has(key)) return
  seen.add(key)
  const root = facts[key]
  if (root !== undefined && root.valid) facts[key] = { ...root, valid: false }
  for (const [candidateKey, candidate] of Object.entries(facts)) {
    if (candidate.valid && candidate.dependencies.includes(key)) invalidateInto(facts, candidateKey, seen)
  }
}

export function invalidateFact(state: VerifiedControlState, key: string): VerifiedControlState {
  const facts = structuredClone(state.facts)
  invalidateInto(facts, key, new Set())
  return { ...state, facts }
}

export function putFact(state: VerifiedControlState, fact: TrustedFact): VerifiedControlState {
  const facts = structuredClone(state.facts)
  const prior = facts[fact.key]
  if (prior !== undefined && !jsonEqual(prior.value, fact.value)) invalidateInto(facts, fact.key, new Set())
  facts[fact.key] = structuredClone(fact)
  return { ...state, facts }
}

export function attestFact(state: VerifiedControlState, key: string, attestor: string): VerifiedControlState {
  const fact = state.facts[key]
  if (!validFact(fact)) throw new Error(`fact ${key} is missing, invalid, or stale`)
  const verifiedBy = fact.verifiedBy.includes(attestor) ? fact.verifiedBy : [...fact.verifiedBy, attestor]
  return { ...state, facts: { ...state.facts, [key]: { ...fact, verifiedBy } } }
}
