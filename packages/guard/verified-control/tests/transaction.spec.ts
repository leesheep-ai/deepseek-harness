import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rollbackFile, snapshotFile } from '../src/transaction.ts'

describe('filesystem transaction helpers', () => {
  it('restores an existing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-'))
    const file = join(root, 'a.txt')
    await writeFile(file, 'before')
    const snapshot = await snapshotFile(root, join(root, '.snapshots'), 'a.txt')
    await writeFile(file, 'after')
    await rollbackFile(snapshot)
    expect(await readFile(file, 'utf8')).toBe('before')
  })

  it('rejects a path escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-'))
    await expect(snapshotFile(root, join(root, '.snapshots'), '../escape.txt')).rejects.toThrow('escapes workspace')
  })

  it('rejects symlink parents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-'))
    const outside = await mkdtemp(join(tmpdir(), 'vc-out-'))
    await mkdir(join(outside, 'dir'))
    await symlink(join(outside, 'dir'), join(root, 'link'))
    await expect(snapshotFile(root, join(root, '.snapshots'), 'link/x.txt')).rejects.toThrow('symlink parent')
  })
})
