import { computed, reactive } from 'vue'
import type { AiSettingsPatchRequest, AiSettingsResponse } from '@srdi/shared'
import { api } from '@/api'

interface AiSettingsState {
  config: AiSettingsResponse | null
  loaded: boolean
  loading: boolean
  saving: boolean
  testing: boolean
  dialogOpen: boolean
}

const state = reactive<AiSettingsState>({
  config: null,
  loaded: false,
  loading: false,
  saving: false,
  testing: false,
  dialogOpen: false
})

const ensure = async (force = false) => {
  if (state.loading) return
  if (state.loaded && !force) return
  state.loading = true
  try {
    state.config = await api.aiSettings()
    state.loaded = true
  } catch {
    state.loaded = false
  } finally {
    state.loading = false
  }
}

const open = () => {
  state.dialogOpen = true
  void ensure(true)
}

const close = () => {
  state.dialogOpen = false
}

const save = async (patch: AiSettingsPatchRequest) => {
  state.saving = true
  try {
    state.config = await api.saveAiSettings(patch)
    state.loaded = true
    return state.config
  } finally {
    state.saving = false
  }
}

const test = async () => {
  state.testing = true
  try {
    return await api.testAi()
  } finally {
    state.testing = false
  }
}

export const useAiSettings = () => {
  const hasKey = computed(() => Boolean(state.config?.hasKey))
  return { state, hasKey, ensure, open, close, save, test }
}
