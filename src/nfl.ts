// Renderer side of the NFL connection. Desktop: window.nflBridge (Electron preload). Browser development:
// the Vite dev-server bridge. Both end in electron/nflClient.cjs, the only code that talks to nfl.api.v1.

export type NflResult<T = Record<string, unknown>> = {
  ok: boolean
  unavailable?: boolean
  status: string
  httpStatus?: number
  data: T | null
  error: string | null
}

export type Op =
  | 'health' | 'lookup' | 'verifySha256' | 'verifyPath' | 'commit' | 'recent' | 'chain'
  | 'receiptVerify' | 'receiptWitness' | 'integrations' | 'receipts'
  | 'ingestLastRun' | 'ingestRuns' | 'ingestFailures' | 'ingestControl'

type Bridge = {
  config: () => Promise<{ apiBase: string; desktop: boolean }>
  request: (op: string, params: unknown) => Promise<NflResult>
  hashFile: () => Promise<{ canceled: boolean; name?: string; bytes?: number; sha256?: string }>
}

declare global {
  interface Window { nflBridge?: Bridge }
}

export async function nflConfig(): Promise<{ apiBase: string; desktop: boolean }> {
  if (window.nflBridge) return window.nflBridge.config()
  const r = await fetch('/__nfl/config')
  return r.json()
}

export async function nfl<T = Record<string, unknown>>(op: Op, params: Record<string, unknown> = {}): Promise<NflResult<T>> {
  try {
    if (window.nflBridge) return (await window.nflBridge.request(op, params)) as NflResult<T>
    const r = await fetch('/__nfl/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, params }),
    })
    return (await r.json()) as NflResult<T>
  } catch {
    return { ok: false, unavailable: true, status: 'UNAVAILABLE', data: null, error: 'EXPLORER_BRIDGE_UNAVAILABLE' }
  }
}

export type HashedFile = { name: string; bytes: number; sha256: string }

// Hash a local file without sending it (or its path) anywhere.
export async function pickAndHashFile(input?: File): Promise<HashedFile | null> {
  if (window.nflBridge && !input) {
    const r = await window.nflBridge.hashFile()
    if (r.canceled || !r.sha256) return null
    return { name: r.name ?? '', bytes: r.bytes ?? 0, sha256: r.sha256 }
  }
  if (!input) return null
  const buf = await input.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return { name: input.name, bytes: input.size, sha256: hex }
}

export function isHex64(s: string): boolean { return /^[0-9a-f]{64}$/.test(s) }
export function isHexDigest(s: string): boolean { return /^[0-9a-f]{4,128}$/.test(s) }
