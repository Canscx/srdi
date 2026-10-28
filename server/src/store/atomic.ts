import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

let seq = 0

export const ensureDir = (dir: string) => mkdir(dir, { recursive: true })

export const exists = async (target: string) => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

export const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export const writeText = async (file: string, text: string) => {
  await ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${seq++}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

export const writeJson = (file: string, data: unknown) =>
  writeText(file, `${JSON.stringify(data, null, 2)}\n`)

export const moveFile = async (from: string, to: string) => {
  await ensureDir(path.dirname(to))
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyFile(from, to)
    await rm(from, { force: true })
  }
}

export const removeFile = async (file: string) => {
  await rm(file, { force: true })
}

export const listDir = async (dir: string) => {
  try {
    return await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export const fileSize = async (file: string) => (await stat(file)).size
