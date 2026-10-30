import type { Request } from 'express'
import type { SessionInfo } from './session'

export interface AuthedRequest extends Request {
  session?: SessionInfo
  clientId?: string
}

export const authed = (req: Request) => req as AuthedRequest
