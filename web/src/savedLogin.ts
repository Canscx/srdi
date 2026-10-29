const KEY = 'srdi.login.v1'

export interface SavedLogin {
  username: string
  password: string
}

const encode = (value: SavedLogin) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `v1:${btoa(binary)}`
}

const decode = (raw: string): SavedLogin | null => {
  if (!raw.startsWith('v1:')) return null
  const binary = atob(raw.slice(3))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SavedLogin>
  if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') return null
  if (parsed.username.length === 0 || parsed.password.length === 0) return null
  return { username: parsed.username, password: parsed.password }
}

export const loadSavedLogin = (): SavedLogin | null => {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const saved = decode(raw)
    if (!saved) window.localStorage.removeItem(KEY)
    return saved
  } catch {
    return null
  }
}

export const saveSavedLogin = (username: string, password: string): boolean => {
  try {
    window.localStorage.setItem(KEY, encode({ username, password }))
    return true
  } catch {
    return false
  }
}

export const clearSavedLogin = () => {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
  }
}
