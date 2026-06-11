import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from './waha-client'

interface PendingLink {
  jid: string | null
  tokenId: string
  shadowUserId: string
}

// Decode the base64url wa_pending_link cookie value. Returns null if malformed.
export function decodePendingLink(cookieValue: string | undefined): PendingLink | null {
  if (!cookieValue) return null
  try {
    const parsed = JSON.parse(Buffer.from(cookieValue, 'base64url').toString('utf-8')) as PendingLink
    if (!parsed?.tokenId || !parsed?.shadowUserId) return null
    return parsed
  } catch {
    return null
  }
}

// Bind a shadow WhatsApp user to a real authenticated profile: link the row,
// consume the token, mark DM state linked, and DM a confirmation. Idempotent —
// safe to call once per login; consumed tokens are skipped by the caller.
export async function completeWhatsAppLink(userId: string, link: PendingLink): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svcAny = svc as any

  // Only act on an unconsumed token (guards against double-processing).
  const { data: token } = await svcAny
    .from('whatsapp_link_tokens')
    .select('id, consumed_at')
    .eq('id', link.tokenId)
    .maybeSingle() as { data: { id: string; consumed_at: string | null } | null }

  if (!token || token.consumed_at) return

  // Link the shadow user to the real profile.
  if (link.jid) {
    await svcAny
      .from('shadow_users')
      .update({ linked_user_id: userId, linked_at: new Date().toISOString() })
      .eq('whatsapp_jid', link.jid)
  } else {
    await svcAny
      .from('shadow_users')
      .update({ linked_user_id: userId, linked_at: new Date().toISOString() })
      .eq('id', link.shadowUserId)
  }

  // Mark the token consumed.
  await svcAny
    .from('whatsapp_link_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', link.tokenId)

  // Transition DM state and confirm via WhatsApp.
  if (link.jid) {
    await svcAny
      .from('whatsapp_dm_state')
      .upsert(
        { jid: link.jid, state: 'linked', updated_at: new Date().toISOString() },
        { onConflict: 'jid' }
      )

    sendWhatsAppMessage(
      link.jid,
      `Your WhatsApp is now linked to your Member Market account! Future posts from this number will appear under your name.`
    ).catch(() => {})
  }
}
