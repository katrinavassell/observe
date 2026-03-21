const TANSO_MCP_URL = process.env.TANSO_MCP_URL || 'https://api.tansohq.com/mcp'
const TANSO_API_KEY = process.env.TANSO_API_KEY || ''

let requestId = 0
let callQueue: Promise<any> = Promise.resolve()

async function rawPost(body: any, sessionId: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'X-API-Key': TANSO_API_KEY,
  }
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    return await fetch(TANSO_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function parseSSE(text: string): any {
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.startsWith('data:')) {
      const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5)
      const trimmed = payload.trim()
      if (trimmed) return JSON.parse(trimmed)
    }
  }
  return null
}

async function parseResponse(res: Response): Promise<any> {
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('text/event-stream')) {
    const text = await res.text()
    const data = parseSSE(text)
    if (!data) throw new Error('No data in SSE response')
    return data
  }
  return res.json()
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function singleInitAndCall(method: string, args: Record<string, any>): Promise<any> {
  requestId++
  const initRes = await rawPost({
    jsonrpc: '2.0',
    id: requestId,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'tanso-dashboard', version: '1.0.0' },
    },
  }, null)

  if (!initRes.ok) {
    const text = await initRes.text()
    throw new Error(`Tanso init failed (${initRes.status}): ${text.substring(0, 200)}`)
  }

  const sid = initRes.headers.get('mcp-session-id')
  if (!sid) throw new Error('No session ID in initialize response')
  await parseResponse(initRes)

  await delay(100)

  requestId++
  const callRes = await rawPost({
    jsonrpc: '2.0',
    id: requestId,
    method: 'tools/call',
    params: { name: method, arguments: args },
  }, sid)

  if (!callRes.ok) {
    const text = await callRes.text()
    throw new Error(`Tanso MCP error (${callRes.status}): ${text.substring(0, 200)}`)
  }

  const data = await parseResponse(callRes)
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
  return extractContent(data)
}

async function initAndCall(method: string, args: Record<string, any>): Promise<any> {
  const maxRetries = 3
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await singleInitAndCall(method, args)
    } catch (err: any) {
      const is404 = err.message?.includes('(404)')
      if (is404 && attempt < maxRetries - 1) {
        await delay(1000 * (attempt + 1))
        continue
      }
      throw err
    }
  }
}

function mcpCall(method: string, args: Record<string, any> = {}): Promise<any> {
  const result = callQueue.then(
    () => initAndCall(method, args),
    () => initAndCall(method, args),
  )
  callQueue = result.then(() => {}, () => {})
  return result
}

function extractContent(data: any): any {
  if (data.result?.content) {
    const textContent = data.result.content.find((c: any) => c.type === 'text')
    if (textContent) {
      try {
        return JSON.parse(textContent.text)
      } catch {
        return textContent.text
      }
    }
  }
  return data.result || data
}

export async function tansoListPlans() {
  return mcpCall('listPlans')
}

export async function tansoListFeatures() {
  return mcpCall('listFeatures')
}

export async function tansoGetCustomer(customerReferenceId: string) {
  return mcpCall('getCustomer', { customerReferenceId })
}

export async function tansoCreateCustomer(externalClientCustomerId: string, email: string, firstName?: string) {
  return mcpCall('createCustomer', {
    externalClientCustomerId,
    email,
    ...(firstName ? { firstName } : {}),
  })
}

export async function tansoCheckEntitlement(customerReferenceId: string, featureKey: string) {
  return mcpCall('checkEntitlement', { customerReferenceId, featureKey })
}

export async function tansoListCustomerEntitlements(customerReferenceId: string) {
  return mcpCall('listCustomerEntitlements', { customerReferenceId })
}

export async function tansoIngestEvent(params: {
  eventIdempotencyKey: string
  eventName: string
  occurredAt: string
  customerReferenceId: string
  featureKey: string
  usageUnits?: string
}) {
  return mcpCall('ingestEvent', params)
}

export async function tansoCreateSubscription(customerReferenceId: string, planId: string) {
  return mcpCall('createSubscription', { customerReferenceId, planId })
}

export async function tansoListCustomerInvoices(customerReferenceId: string) {
  return mcpCall('listCustomerInvoices', { customerReferenceId })
}

export async function tansoGetCreditPools(customerReferenceId: string) {
  return mcpCall('getCreditPools', { customerReferenceId })
}

export async function tansoCreateCheckoutSession(invoiceId: string): Promise<{ url: string }> {
  const baseUrl = (process.env.TANSO_MCP_URL || 'https://api.tansohq.com/mcp').replace('/mcp', '')
  const res = await fetch(`${baseUrl}/api/v1/client/billing/invoices/${encodeURIComponent(invoiceId)}/stripe/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TANSO_API_KEY,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Checkout session failed (${res.status}): ${text.substring(0, 200)}`)
  }
  const data = await res.json()
  return data.data || data
}

export function isTansoConfigured(): boolean {
  return !!TANSO_API_KEY
}
