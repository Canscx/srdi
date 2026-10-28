export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly hint?: string

  constructor(status: number, code: string, message: string, hint?: string) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.hint = hint
  }
}

export const badRequest = (code: string, message: string, hint?: string) =>
  new AppError(400, code, message, hint)

export const notFound = (code: string, message: string, hint?: string) =>
  new AppError(404, code, message, hint)

export const unsupported = (code: string, message: string, hint?: string) =>
  new AppError(415, code, message, hint)

export const tooLarge = (code: string, message: string, hint?: string) =>
  new AppError(413, code, message, hint)

export const conflict = (code: string, message: string, hint?: string) =>
  new AppError(409, code, message, hint)
