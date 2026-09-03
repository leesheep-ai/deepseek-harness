import { describe, expect, it } from 'vitest'
import { attestFact, invalidateFact, publicFactValues, putFact } from '../src/state.ts'
import { EMPTY_CONTROL_STATE, type TrustedFact } from '../src/types.ts'

const fact = (key: string, value: number, dependencies: string[] = []): TrustedFact => ({
  key, value, origin: 'model', source: 'model:test', confidence: 0.7,
  observedAt: 10, verifiedBy: [], dependencies, valid: true,
})

describe('verified-control world state', () => {
  it('invalidates dependent facts when a root value changes', () => {
    let state = putFact(EMPTY_CONTROL_STATE, fact('root', 1))
    state = putFact(state, fact('child', 2, ['root']))
    state = putFact(state, fact('root', 3))
    expect(state.facts.root?.valid).toBe(true)
    expect(state.facts.child?.valid).toBe(false)
  })

  it('cascades explicit invalidation', () => {
    let state = putFact(EMPTY_CONTROL_STATE, fact('a', 1))
    state = putFact(state, fact('b', 2, ['a']))
    state = putFact(state, fact('c', 3, ['b']))
    state = invalidateFact(state, 'a')
    expect(state.facts.a?.valid).toBe(false)
    expect(state.facts.b?.valid).toBe(false)
    expect(state.facts.c?.valid).toBe(false)
  })

  it('filters stale facts from the current truth view', () => {
    let state = putFact(EMPTY_CONTROL_STATE, { ...fact('stale', 1), validUntil: 20 })
    state = putFact(state, { ...fact('fresh', 2), validUntil: 100 })
    expect(publicFactValues(state, 50)).toEqual({ fresh: 2 })
  })

  it('requires an independent attestor to certify a model observation', () => {
    let state = putFact(EMPTY_CONTROL_STATE, fact('answer', 42))
    expect(state.facts.answer?.verifiedBy).toEqual([])
    state = attestFact(state, 'answer', 'human')
    expect(state.facts.answer?.verifiedBy).toEqual(['human'])
  })
})
