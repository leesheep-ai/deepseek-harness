import { lstat, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { installTransactionRuntime } from '../src/transaction-runtime.ts'
import { captureFileTransaction, FileTransactionLocks, rollbackFileTransaction } from '../src/transaction.ts'

class LocalFs {
  constructor(private readonly root: string, private readonly hostBacked = true) {}
  async lstat(path: string, opts: { cwd?: string } = {}) {
    try { const info = await lstat(join(opts.cwd ?? this.root, path)); return { type: info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', version: 'v' } } catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error }
  }
  async resolve(path: string, opts: { cwd?: string } = {}) { const displayPath = join(opts.cwd ?? this.root, path); return { displayPath, targetKey: displayPath } }
  async stat(target: { displayPath: string }) { try { const info = await stat(target.displayPath); return { type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', version: 'v' } } catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error } }
  async readText(target: { displayPath: string }) { return readFile(target.displayPath, 'utf8') }
  async writeText(target: { displayPath: string }, content: string) { await writeFile(target.displayPath, content); return { operation: 'update', version: 'v', before: null, after: content } }
  processPath(target: { displayPath: string }) { return target.displayPath }
  processPathFromHostPath(path: string) { return this.hostBacked ? path : undefined }
}

describe('filesystem transaction engine', () => {
  it('restores an existing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-'))
    const fs = new LocalFs(root) as any
    await writeFile(join(root, 'a.txt'), 'before')
    const tx = await captureFileTransaction(fs, { id: '1', tool: 'write', path: 'a.txt', cwd: root })
    await writeFile(join(root, 'a.txt'), 'after')
    await rollbackFileTransaction(fs, tx)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('before')
  })

  it('removes a newly created file only when host backing is proven', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-'))
    const fs = new LocalFs(root) as any
    const tx = await captureFileTransaction(fs, { id: '1', tool: 'write', path: 'new.txt', cwd: root })
    await writeFile(join(root, 'new.txt'), 'new')
    await rollbackFileTransaction(fs, tx)
    await expect(readFile(join(root, 'new.txt'), 'utf8')).rejects.toThrow()
  })

  it('fails closed for remote new-file rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-'))
    const fs = new LocalFs(root, false) as any
    const tx = await captureFileTransaction(fs, { id: '1', tool: 'write', path: 'new.txt', cwd: root })
    await writeFile(join(root, 'new.txt'), 'new')
    await expect(rollbackFileTransaction(fs, tx)).rejects.toThrow('manual reconciliation')
  })

  it('serializes conflicting file transactions', async () => {
    const locks = new FileTransactionLocks()
    const order: number[] = []
    await Promise.all([
      locks.run('a', async () => { order.push(1); await new Promise(resolve => setTimeout(resolve, 20)); order.push(2) }),
      locks.run('a', async () => { order.push(3) }),
    ])
    expect(order).toEqual([1, 2, 3])
  })

  it('fails closed when a configured mutation tool has no trackable file_path', async () => {
    let execute: ((exec: any, next: () => Promise<any>) => Promise<any>) | undefined
    const ctx = {
      on(event: string, handler: any) {
        if (event === 'tools/execute') execute = handler
      },
    } as any
    installTransactionRuntime(ctx, { mutationTools: ['custom_mutation'], cleanupTimeoutMs: 100 })
    const next = vi.fn(async () => ({ content: [], isError: false }))

    const result = await execute?.({
      agent: {},
      name: 'custom_mutation',
      arguments: { target: 'x' },
      signal: new AbortController().signal,
    }, next)

    expect(next).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: 'MUTATION_PATH_REQUIRED' } },
    })
  })
})
