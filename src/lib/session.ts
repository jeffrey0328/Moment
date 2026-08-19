const SESSION_KEY = 'shiguang_session'

export function readClientSession() {
  try {
    return localStorage.getItem(SESSION_KEY) || undefined
  } catch {
    return undefined
  }
}

export function saveClientSession(session: string) {
  localStorage.setItem(SESSION_KEY, session)
}

export function clearClientSession() {
  localStorage.removeItem(SESSION_KEY)
}

export function authHeaders(): Record<string, string> {
  const session = readClientSession()
  return session ? { Authorization: `Bearer ${session}` } : {}
}
