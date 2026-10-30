import { Router } from 'express'
import type { CatalogResponse, RulesMetaResponse } from '@srdi/shared'
import { catalogVersion, catalogFields } from '../config/catalog'
import { rulesMeta } from '../config/rules'
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
    const payload: RulesMetaResponse = rulesMeta()
    res.json(payload)
  })

  return router
}
