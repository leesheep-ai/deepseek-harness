import { describe, expect, it } from 'vitest'
import { promoteCrashOrphansToReview, reconcileExternalEffect } from '../src/external-effect-runtime.ts'
import { EMPTY_CONTROL_STATE } from '../src/types.ts'

function state(status: 'open' | 'review' | 'resolved' = 'open') {
  return {
    ...EMPTY_CONTROL_STATE,
    externalEffects: {
      e1: { id: 'e1', tool: 'deploy', callId: 'c1', openedAt: 1, status },
    },
  }
}

describe('external effect reconciliation', () => {
  it('promotes crash-orphaned effects to review', () => {
    const next = promoteCrashOrphansToReview(state())
    expect(next.externalEffects.e1?.status).toBe('review')
    expect(next.incidents).toHaveLength(1)
  })

  it('closes review only with an explicit resolution', () => {
    const reviewed = promoteCrashOrphansToReview(state())
    const next = reconcileExternalEffect(reviewed, 'e1', 'compensated', 'rolled back manually')
    expect(next.externalEffects.e1?.status).toBe('resolved')
    expect(next.externalEffects.e1?.resolution).toBe('compensated')
  })

  it('rejects double reconciliation', () => {
    const resolved = reconcileExternalEffect(state(), 'e1', 'confirmed')
    expect(() => reconcileExternalEffect(resolved, 'e1', 'not-applied')).toThrow('already resolved')
  })
})
