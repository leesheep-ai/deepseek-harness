import { lstat as hostLstat, rm as hostRm } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { OpenTransaction } from './types.ts'

function within(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export async function captureFileTransaction(
  fs: FileSystem,
  input: { id: string; tool: string; path: string; cwd?: string; signal?: AbortSignal },
): Promise<OpenTransaction> {
  const pathInfo = await fs.lstat(
    input.path,
    input.cwd === undefined ? undefined : { cwd: input.cwd },
    input.signal,
  )
  if (pathInfo?.type === 'symlink') throw new Error(`transaction target may not be a symbolic link: ${input.path}`)
  const target = await fs.resolve(input.path, { ...(input.cwd === undefined ? {} : { cwd: input.cwd }), ...(input.signal === undefined ? {} : { signal: input.signal }) })
  const info = await fs.stat(target, input.signal)
  if (info !== undefined && info.type !== 'file') throw new Error(`transaction target is not a regular file: ${target.displayPath}`)
  const before = info === undefined ? null : await fs.readText(target, input.signal)
  return {
    id: input.id,
    tool: input.tool,
    path: input.path,
    displayPath: target.displayPath,
    before,
    openedAt: Date.now(),
    status: 'open',
    ...(input.cwd === undefined ? {} : { workspaceRoot: input.cwd }),
  }
}

async function provenHostPath(fs: FileSystem, target: FsTarget, workspaceRoot: string | undefined): Promise<string | undefined> {
  if (workspaceRoot === undefined) return undefined
  const processPath = fs.processPath(target)
  if (!isAbsolute(processPath) || !within(workspaceRoot, processPath)) return undefined
  const roundTrip = fs.processPathFromHostPath(processPath)
  if (roundTrip !== processPath) return undefined
  try {
    const info = await hostLstat(processPath)
    if (!info.isFile() || info.isSymbolicLink()) return undefined
  } catch {
    return undefined
  }
  return processPath
}

export async function rollbackFileTransaction(
  fs: FileSystem,
  tx: OpenTransaction,
  cleanupTimeoutMs = 10_000,
): Promise<void> {
  const signal = AbortSignal.timeout(cleanupTimeoutMs)
  const target = await fs.resolve(tx.path, { ...(tx.workspaceRoot === undefined ? {} : { cwd: tx.workspaceRoot }), signal })
  if (tx.before !== null) {
    await fs.writeText(target, tx.before, undefined, signal)
    return
  }
  const hostPath = await provenHostPath(fs, target, tx.workspaceRoot)
  if (hostPath === undefined) throw new Error('new-file rollback cannot prove a host-backed workspace path; manual reconciliation is required')
  await hostRm(hostPath, { force: true })
}

export class FileTransactionLocks {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>(resolveGate => { release = resolveGate })
    const tail = previous.then(() => gate)
    this.tails.set(key, tail)
    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}
