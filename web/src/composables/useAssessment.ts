import { ref } from 'vue'
import type { ProjectCompany } from '@srdi/shared'
import { api, errorText } from '@/api'

export type AssessPhase = 'idle' | 'creating' | 'uploading' | 'starting' | 'done' | 'error'

export interface SlotInput {
  slot: string
  files: File[]
}

export interface StartInput {
  company: ProjectCompany
  period: { y0: number; y1: number; y2: number }
  slots: SlotInput[]
}

export const useAssessment = () => {
  const phase = ref<AssessPhase>('idle')
  const uploaded = ref(0)
  const total = ref(0)
  const message = ref('')
  const error = ref('')

  const reset = () => {
    phase.value = 'idle'
    uploaded.value = 0
    total.value = 0
    message.value = ''
    error.value = ''
  }

  const start = async (input: StartInput) => {
    reset()
    total.value = input.slots.reduce((sum, item) => sum + item.files.length, 0)
    if (total.value === 0) {
      phase.value = 'error'
      error.value = '至少上传一份材料'
      return null
    }

    try {
      phase.value = 'creating'
      message.value = '正在创建评估'
      const created = await api.createPortalProject({
        company: input.company,
        period: input.period
      })

      phase.value = 'uploading'
      for (const slot of input.slots) {
        for (const file of slot.files) {
          message.value = `正在上传 ${file.name}`
          await api.portalUpload(created.projectId, slot.slot, file)
          uploaded.value += 1
        }
      }

      phase.value = 'starting'
      message.value = '正在启动评估'
      const job = await api.portalAssess(created.projectId)
      phase.value = 'done'
      return { projectId: created.projectId, jobId: job.jobId, queueAhead: job.queueAhead }
    } catch (err) {
      phase.value = 'error'
      error.value = errorText(err)
      return null
    }
  }

  return { phase, uploaded, total, message, error, start, reset }
}
