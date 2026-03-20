const TANSO_MCP_URL = process.env.TANSO_MCP_URL || 'https://api.tansohq.com/mcp'
const TANSO_API_KEY = process.env.TANSO_API_KEY || ''

let requestId = 0

async function mcpCall(method: string, args: Record<string, any> = {}): Promise<any> {
  requestId++
  const body = {
    jsonrpc: '2.0',
    id: requestId,
    method: 'tools/call',
    params: {
      name: method,
      arguments: args,
    },
  }

  const res = await fetch(TANSO_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'X-API-Key': TANSO_API_KEY,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Tanso MCP error (${res.status}): ${text}`)
  }

  const contentType = res.headers.get('content-type') || ''

  if (contentType.includes('text/event-stream')) {
    const text = await res.text()
    const lines = text.split('\n')
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6))
        if (data.result?.content) {
          const textContent = data.result.content.find((c: any) => c.type === 'text')
          if (textContent) return JSON.parse(textContent.text)
        }
        if (data.error) throw new Error(data.error.message || 'MCP error')
        return data.result || data
      }
    }
    throw new Error('No data in SSE response')
  }

  const data = await res.json()

  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error))
  }

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

export function isTansoConfigured(): boolean {
  return !!TANSO_API_KEY
}
