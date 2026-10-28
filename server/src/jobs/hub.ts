import type { JobProgressEvent } from '@srdi/shared'

type Listener = (event: JobProgressEvent) => void

const listeners = new Map<string, Set<Listener>>()

export const subscribe = (jobId: string, listener: Listener) => {
  const bucket = listeners.get(jobId) ?? new Set<Listener>()
  bucket.add(listener)
  listeners.set(jobId, bucket)
  return () => {
    bucket.delete(listener)
    if (bucket.size === 0) listeners.delete(jobId)
  }
}

export const publish = (jobId: string, event: JobProgressEvent) => {
  const bucket = listeners.get(jobId)
  if (!bucket) return 0
  for (const listener of bucket) listener(event)
  return bucket.size
}

export const subscriberCount = (jobId: string) => listeners.get(jobId)?.size ?? 0
