import type { PortalResultResponse } from './portal'
import type { RulesMetaResponse, ScoreRecord } from './contracts'

export interface AdminProfessional {
  record: ScoreRecord
  rules: RulesMetaResponse
}

export interface AdminPortalResult extends PortalResultResponse {
  projectName: string
  professional: AdminProfessional
}
