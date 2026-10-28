import { ref } from 'vue'

export type RouteName = 'projects' | 'review' | 'score' | 'status'

export interface RouteState {
  name: RouteName
  projectId?: string
}

const parse = (): RouteState => {
  const hash = window.location.hash.replace(/^#/, '')
  const review = /^\/p\/([A-Za-z0-9_-]+)\/review\/?$/.exec(hash)
  if (review) return { name: 'review', projectId: review[1] }
  const score = /^\/p\/([A-Za-z0-9_-]+)\/score\/?$/.exec(hash)
  if (score) return { name: 'score', projectId: score[1] }
  if (/^\/status\/?$/.test(hash)) return { name: 'status' }
  return { name: 'projects' }
}

const route = ref<RouteState>(parse())

window.addEventListener('hashchange', () => {
  route.value = parse()
})

export const useRoute = () => route

export const goto = (path: string) => {
  if (window.location.hash === `#${path}`) return
  window.location.hash = path
}
