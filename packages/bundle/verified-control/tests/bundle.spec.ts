import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('verified-control bundle', () => {
  it('declares an opt-in patch that mounts only the verified-control row', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-verified-control', 'workspace:^')
    const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain("id: verified-control")
    expect(patch).toContain("name: '@deepseek-ai/dsh-verified-control'")
    expect(patch).toContain('allowNetwork: false')
    expect(patch).toContain('irreversibleTools: []')
    expect(patch).toContain('adaptiveEffort: false')
    expect(patch).not.toContain('@deepseek-ai/dsh-base')
  })
})
