import { computed, ref } from 'vue'
import type { AuthStatusResponse } from '@srdi/shared'
import { api } from '@/api'

const state = ref<AuthStatusResponse>({ authenticated: false })
const ready = ref(false)

export const useSession = () => {
  const ensure = async (force = false) => {
    if (ready.value && !force) return state.value
    try {
      state.value = await api.authStatus()
    } catch {
      state.value = { authenticated: false }
    }
    ready.value = true
    return state.value
  }

  const reset = () => {
    state.value = { authenticated: false }
    ready.value = false
  }

  const role = computed(() => state.value.role ?? 'customer')

  return { state, ready, ensure, reset, role }
}
