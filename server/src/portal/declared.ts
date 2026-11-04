import type { ProjectMeta } from '@srdi/shared'
import type { AppStore } from '../store'

export interface DeclaredInput {
  inventionCount?: number
  layoutDesignCount?: number
  softCopyrightCount?: number
  utilityModelCount?: number
  designPatentCount?: number
  selfDevelopedI?: boolean
  highValueI?: boolean
}

export interface DeclaredOutcome {
  applied: boolean
  reason?: string
  classI: number
  classII: number
  selfDeveloped: boolean
  highValue: boolean
}

const positiveInt = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

const hasAnyInput = (input: DeclaredInput) =>
  [
    input.inventionCount,
    input.layoutDesignCount,
    input.softCopyrightCount,
    input.utilityModelCount,
    input.designPatentCount,
    input.selfDevelopedI,
    input.highValueI
  ].some((value) => value !== undefined)

export const applyDeclaredIntellectual = async (
  store: AppStore,
  project: ProjectMeta,
  input: DeclaredInput
): Promise<DeclaredOutcome> => {
  const classI = positiveInt(input.inventionCount) + positiveInt(input.layoutDesignCount)
  const classII =
    positiveInt(input.softCopyrightCount) +
    positiveInt(input.utilityModelCount) +
    positiveInt(input.designPatentCount)
  const selfDeveloped = classI > 0 && input.selfDevelopedI === true
  const highValue = classI > 0 && input.highValueI === true

  const base: DeclaredOutcome = {
    applied: false,
    classI,
    classII,
    selfDeveloped,
    highValue
  }

  if (!hasAnyInput(input)) return { ...base, reason: 'nothing_declared' }

  const doc = await store.evidence.get(project)
  if (doc.fields['ip.classICount']?.status === 'confirmed') {
    return { ...base, reason: 'documented' }
  }

  const note = `客户自述：Ⅰ类 ${classI} 件${selfDeveloped ? '（含自主研发）' : ''}${
    highValue ? '（含高价值）' : ''
  }，Ⅱ类 ${classII} 件`

  await store.evidence.declareValue(project, 'ip.classICount', { value: classI, note })
  await store.evidence.declareValue(project, 'ip.classIICount', { value: classII, note })
  await store.evidence.declareValue(project, 'ip.selfDevelopedI', { value: selfDeveloped, note })
  await store.evidence.declareValue(project, 'ip.highValueI', { value: highValue, note })

  return { ...base, applied: true }
}
