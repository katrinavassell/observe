// In-memory session store for API keys
// Keys are stored per session ID and cleared on server restart

interface SessionApiKey {
  apiKey: string
  setAt: Date
}

class ApiKeyStore {
  private keys: Map<string, SessionApiKey> = new Map()

  set(sessionId: string, apiKey: string): void {
    this.keys.set(sessionId, { apiKey, setAt: new Date() })
  }

  get(sessionId: string): string | null {
    return this.keys.get(sessionId)?.apiKey || null
  }

  has(sessionId: string): boolean {
    return this.keys.has(sessionId)
  }

  delete(sessionId: string): void {
    this.keys.delete(sessionId)
  }

  clear(): void {
    this.keys.clear()
  }
}

export const apiKeyStore = new ApiKeyStore()
