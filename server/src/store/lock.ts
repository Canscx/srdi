export type LockTable = <T>(key: string, task: () => Promise<T>) => Promise<T>

export const createLockTable = (): LockTable => {
  const tails = new Map<string, Promise<void>>()

  return async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => gate)
    tails.set(key, tail)
    await previous.catch(() => undefined)
    try {
      return await task()
    } finally {
      release()
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}
