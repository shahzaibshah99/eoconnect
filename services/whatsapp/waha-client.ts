import 'server-only'
import { createClient } from '@supabase/supabase-js'

interface SendMessageResult {
  ok: boolean
  messageId?: string
  error?: string
}

// Send-rate limits (WhatsApp bans numbers that send fast bursts of automated
// DMs). Enforced via the whatsapp_send_log table so the limit holds across
// serverless invocations — an in-memory queue would not persist on Vercel.
const PER_JID_COOLDOWN_MS = 10_000   // max 1 DM per JID per 10s
const HOURLY_CAP = 30                // max 30 DMs/hour globally
const JITTER_MIN_MS = 2_000          // randomised 2-5s delay before each send
const JITTER_MAX_MS = 5_000

function rateLimitDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// Returns { allowed } and, when allowed, records the send. Fails OPEN (allows
// the send) if the rate-limit store is unreachable — we'd rather deliver than
// silently drop on an infra hiccup.
async function checkAndRecordSendLimit(jid: string): Promise<{ allowed: boolean; reason?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { allowed: true }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rateLimitDb() as any
    const now = Date.now()

    // (a) per-JID cooldown
    const { data: recent } = await db
      .from('whatsapp_send_log')
      .select('sent_at')
      .eq('jid', jid)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle() as { data: { sent_at: string } | null }

    if (recent && now - new Date(recent.sent_at).getTime() < PER_JID_COOLDOWN_MS) {
      return { allowed: false, reason: 'per_jid_cooldown' }
    }

    // (b) global hourly cap
    const hourAgo = new Date(now - 60 * 60 * 1000).toISOString()
    const { count } = await db
      .from('whatsapp_send_log')
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', hourAgo) as { count: number | null }

    if ((count ?? 0) >= HOURLY_CAP) {
      return { allowed: false, reason: 'hourly_cap' }
    }

    // Record this send up-front so concurrent invocations see it.
    await db.from('whatsapp_send_log').insert({ jid })
    return { allowed: true }
  } catch (err) {
    console.error('[waha-client] rate-limit check failed, allowing send:', err)
    return { allowed: true }
  }
}

// @s.whatsapp.net is the same phone number in another notation — a safe swap.
// @lid is WhatsApp's opaque "hidden id"; its digits are NOT a phone number, so
// it must be resolved via WAHA's /lids/{lid} API (see resolveJid below).
function normaliseSuffix(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, '@c.us')
}

// Resolve a @lid to the real phone JID (...@c.us) using WAHA's LID mapping API:
//   GET /api/{session}/lids/{lid} -> { lid, pn }   (pn is the phone JID, or null)
// Returns the original jid unchanged for non-@lid inputs or if resolution fails.
async function resolveJid(jid: string, apiUrl: string, apiKey: string | undefined, session: string): Promise<string> {
  if (!jid.endsWith('@lid')) return normaliseSuffix(jid)

  try {
    const res = await fetch(
      `${apiUrl}/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(jid)}`,
      {
        headers: { ...(apiKey ? { 'X-Api-Key': apiKey } : {}) },
        signal: AbortSignal.timeout(10_000),
      }
    )
    if (!res.ok) {
      console.error('[WAHA] LID resolve failed:', res.status, jid)
      return jid
    }
    const data = await res.json().catch(() => ({})) as { lid?: string; pn?: string | null }
    console.log('[WAHA] LID resolved:', jid, '→', data?.pn ?? '(no pn)')
    return data?.pn ?? jid
  } catch (err) {
    console.error('[WAHA] LID resolve error:', err instanceof Error ? err.message : err)
    return jid
  }
}

export async function sendWhatsAppMessage(jid: string, text: string): Promise<SendMessageResult> {
  const apiUrl = process.env.WAHA_BASE_URL?.replace(/\/$/, '')
  const apiKey = process.env.WAHA_API_KEY
  const session = process.env.WAHA_SESSION_NAME ?? 'default'

  if (!apiUrl) {
    console.warn('[waha-client] WAHA_BASE_URL not configured — skipping send')
    return { ok: false, error: 'waha_not_configured' }
  }

  const normalisedJid = await resolveJid(jid, apiUrl, apiKey, session)
  console.log('[WAHA] DM jid conversion:', { original: jid, converted: normalisedJid, changed: jid !== normalisedJid })

  // Guard: never send to an unresolved @lid — WAHA's sendText won't deliver it.
  if (normalisedJid.endsWith('@lid')) {
    console.error('[WAHA] could not resolve LID to phone JID, refusing to send:', jid)
    return { ok: false, error: 'unresolved_lid' }
  }

  // Throttle to protect the WhatsApp number from spam bans.
  const limit = await checkAndRecordSendLimit(normalisedJid)
  if (!limit.allowed) {
    console.warn('[WAHA] send rate-limited:', limit.reason, normalisedJid)
    return { ok: false, error: `rate_limited_${limit.reason}` }
  }

  // Randomised 2-5s delay so consecutive sends don't look like a bot burst.
  const jitter = JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS))
  await new Promise(resolve => setTimeout(resolve, jitter))

  try {
    const res = await fetch(`${apiUrl}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
      },
      body: JSON.stringify({ chatId: normalisedJid, text, session }),
      signal: AbortSignal.timeout(10_000),
    })

    console.log('[WAHA] DM response status:', res.status)

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown')
      console.error('[waha-client] send failed:', res.status, errText)
      return { ok: false, error: `http_${res.status}` }
    }

    const data = await res.json().catch(() => ({}))
    return { ok: true, messageId: data?.id ?? undefined }
  } catch (err) {
    console.error('[waha-client] send error:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}
