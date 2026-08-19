import type { AgentRecipientPlatform } from '@/lib/parseAgentCommand'

export interface RecentRecipient {
  /** Dedupe key: `${platform}:${identifier}` */
  key: string
  platform: AgentRecipientPlatform
  identifier: string
  lastAmount: number
  lastAt: string
}

interface HistoryPaymentRow {
  direction?: 'from_sender' | 'from_recipient'
  amount?: string | number
  paid_at?: string | null
  created_at?: string | null
  recipient_username?: string | null
  recipient_email?: string | null
  recipient_address?: string
}

function classify(row: HistoryPaymentRow): { platform: AgentRecipientPlatform; identifier: string } | null {
  if (row.recipient_email) {
    return { platform: 'email', identifier: row.recipient_email.toLowerCase() }
  }
  if (typeof row.recipient_address === 'string') {
    // "PENDING_SOCIAL:telegram:handle" style — case varies by write path, normalize to upper.
    const m = row.recipient_address.match(/^PENDING_SOCIAL:([a-z]+):(.+)$/i)
    if (m) {
      const plat = m[1].toLowerCase()
      if (plat === 'discord' || plat === 'github' || plat === 'telegram' || plat === 'twitter') {
        return { platform: plat, identifier: m[2].toLowerCase() }
      }
    }
  }
  if (row.recipient_username) {
    // Loofta usernames are always created with a "loo-" prefix client-side; a Twitter handle
    // sent via the treatUnregisteredAsTwitter path is stored bare, with no prefix — the only
    // signal available from this field alone to tell the two apart.
    const raw = row.recipient_username
    if (/^loo-/i.test(raw)) {
      return { platform: 'username', identifier: raw.replace(/^loo-/i, '').toLowerCase() }
    }
    return { platform: 'twitter', identifier: raw.toLowerCase() }
  }
  return null
}

/** Recipients this user has previously sent to, most recent first, one entry per recipient
 *  (keeping their latest amount/date) — powers the "@" autocomplete in the AI bot chat box. */
export async function fetchRecentRecipients(accessToken: string | null | undefined, networkMode: string): Promise<RecentRecipient[]> {
  try {
    const params = networkMode ? `?network=${networkMode}` : ''
    const r = await fetch(`/api/payments/history${params}`, {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      cache: 'no-store',
    })
    if (!r.ok) return []
    const data: { sent?: HistoryPaymentRow[] } = await r.json().catch(() => ({}))
    const sent = (data.sent ?? []).filter((row) => row.direction !== 'from_recipient')

    const byKey = new Map<string, RecentRecipient>()
    for (const row of sent) {
      const classified = classify(row)
      if (!classified) continue
      const at = row.paid_at || row.created_at
      const amount = parseFloat(String(row.amount ?? '0'))
      if (!at || !Number.isFinite(amount)) continue
      const key = `${classified.platform}:${classified.identifier}`
      const existing = byKey.get(key)
      if (!existing || new Date(at).getTime() > new Date(existing.lastAt).getTime()) {
        byKey.set(key, { key, ...classified, lastAmount: amount, lastAt: at })
      }
    }
    return Array.from(byKey.values()).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
  } catch {
    return []
  }
}
