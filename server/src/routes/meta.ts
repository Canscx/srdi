import { Router } from 'express'
import type { CatalogResponse, RulesMetaResponse } from '@srdi/shared'
import { catalogVersion, catalogFields } from '../config/catalog'
import { loadRules } from '../config/rules'
import { autoConfirmPolicy } from '../config/review'

export const metaRouter = () => {
  const router = Router()

  router.get('/meta/catalog', (_req, res) => {
    const payload: CatalogResponse = {
      version: catalogVersion(),
      fields: catalogFields().map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        unit: field.unit,
        periodic: field.periodic,
        dataClass: field.dataClass,
        enumValues: field.enumValues,
        aliases: field.aliases,
        description: field.description,
        docTypes: field.docTypes
      })),
      autoConfirm: autoConfirmPolicy()
    }
    res.json(payload)
  })

  router.get('/meta/rules', (_req, res) => {
    const rules = loadRules()
    const payload: RulesMetaResponse = {
      rulesId: rules.rulesId,
      version: rules.schemaVersion,
      level: rules.level,
      levelName: rules.levelName,
      passLine: rules.passLine,
      dimensions: rules.dimensions.map((dimension) => ({
        id: dimension.id,
        name: dimension.name,
        weight: dimension.weight,
        indicators: dimension.indicators.map((indicator) => ({
          id: indicator.id,
          code: indicator.code,
          name: indicator.name,
          unit: indicator.unit,
          dataClass: indicator.dataClass,
          share: indicator.share,
          scoringType: indicator.scoring.type,
          evidenceRefs: indicator.evidenceRefs ?? [],
          formula: indicator.formula?.expr,
          fallback: indicator.fallback
            ? { type: indicator.fallback.type, reason: indicator.fallback.reason }
            : undefined
        }))
      })),
      assumptions: rules.assumptions ?? []
    }
    res.json(payload)
  })

  return router
}
