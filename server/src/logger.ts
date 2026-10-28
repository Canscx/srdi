import type { NextFunction, Request, Response } from 'express'

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startedAt = process.hrtime.bigint()
  res.on('finish', () => {
    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e6
    console.log(`${String(res.statusCode)} ${req.method} ${req.originalUrl} ${elapsed.toFixed(1)}ms`)
  })
  next()
}
