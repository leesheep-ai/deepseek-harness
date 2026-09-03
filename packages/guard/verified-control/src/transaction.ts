import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

export interface FileSnapshot {
  id: string
  targetPath: string
  snapshotPath: string
  existedBefore: boolean
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function assertNoSymlinkParents(root: string, target: string): Promise<void> {
  const rel = relative(root, target)
  if (!within(root, target)) throw new Error(`path escapes workspace: ${target}`)
  const parts = rel.split(sep).filter(Boolean)
  let cursor = root
  for (const part of parts.slice(0, -1)) {
    cursor = join(cursor, part)
    try {
      const info = await lstat(cursor)
      if (info.isSymbolicLink()) throw new Error(`symlink parent is not transactional: ${cursor}`)
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') break
      throw error
    }
  }
}

export function resolveWorkspacePath(workspace: string, path: string): string {
  const root = resolve(workspace)
  const target = resolve(root, normalize(path))
  if (!within(root, target)) throw new Error(`path escapes workspace: ${path}`)
  return target
}

export async function snapshotFile(
  workspace: string,
  transactionRoot: string,
  path: string,
): Promise<FileSnapshot> {
  const targetPath = resolveWorkspacePath(workspace, path)
  await assertNoSymlinkParents(resolve(workspace), targetPath)
  const id = randomUUID()
  const snapshotPath = join(transactionRoot, `${id}.snapshot`)
  await mkdir(transactionRoot, { recursive: true })
  let existedBefore = false
  try {
    const info = await stat(targetPath)
    if (!info.isFile()) throw new Error(`transaction target is not a regular file: ${path}`)
    existedBefore = true
    await writeFile(snapshotPath, await readFile(targetPath))
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }
  return { id, targetPath, snapshotPath, existedBefore }
}

export async function rollbackFile(snapshot: FileSnapshot): Promise<void> {
  if (snapshot.existedBefore) {
    const bytes = await readFile(snapshot.snapshotPath)
    await mkdir(dirname(snapshot.targetPath), { recursive: true })
    await writeFile(snapshot.targetPath, bytes)
  } else {
    await rm(snapshot.targetPath, { force: true })
  }
  await rm(snapshot.snapshotPath, { force: true })
}

export async function commitFile(snapshot: FileSnapshot): Promise<void> {
  await rm(snapshot.snapshotPath, { force: true })
}
