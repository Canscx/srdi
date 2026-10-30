import { ref } from 'vue'

export type RouteName =
  | 'login'
  | 'portal-home'
  | 'portal-assessing'
  | 'portal-result'
  | 'admin-submissions'
  | 'projects'
  | 'review'
  | 'score'
  | 'status'

export interface RouteState {
  name: RouteName
  projectId?: string
  jobId?: string
}

const parse = (): RouteState => {
  const hash = window.location.hash.replace(/^#/, '')
  if (/^\/login\/?$/.test(hash)) return { name: 'login' }
  if (/^\/admin\/?$/.test(hash)) return { name: 'admin-submissions' }
  const assess = /^\/assess\/([A-Za-z0-9_-]+)(?:\?p=([A-Za-z0-9_-]+))?\/?$/.exec(hash)
  if (assess) return { name: 'portal-assessing', jobId: assess[1], projectId: assess[2] }
  const result = /^\/r\/([A-Za-z0-9_-]+)\/?$/.exec(hash)
  if (result) return { name: 'portal-result', projectId: result[1] }
  const review = /^\/p\/([A-Za-z0-9_-]+)\/review\/?$/.exec(hash)
  if (review) return { name: 'review', projectId: review[1] }
  const score = /^\/p\/([A-Za-z0-9_-]+)\/score\/?$/.exec(hash)
  if (score) return { name: 'score', projectId: score[1] }
  if (/^\/status\/?$/.test(hash)) return { name: 'status' }
  if (/^\/projects\/?$/.test(hash)) return { name: 'projects' }
  return { name: 'portal-home' }
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
