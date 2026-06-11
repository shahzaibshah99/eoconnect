import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from './waha-client'
import { mintLinkToken, sendLinkEmail } from './link-token'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface DmEvent {
  jid: string
  messageText: string
  displayName: string
}

type DmState = 'awaiting_reply' | 'awaiting_verification' | 'linked'

interface DmStateRow {
  jid: string
  state: DmState
  last_post_id: string | null
  updated_at: string
}

export async function handleDmEvent(event: DmEvent): Promise<void> {
  const { jid, messageText, displayName } = event
  const db = adminDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  const { data: stateRow } = await dbAny
    .from('whatsapp_dm_state')
    .select('jid, state, last_post_id, updated_at')
    .eq('jid', jid)
    .maybeSingle() as { data: DmStateRow | null }

  const state: DmState = stateRow?.state ?? 'awaiting_reply'

  // Rate limit: don't send multiple replies within 60 seconds
  if (stateRow?.updated_at) {
    const lastUpdate = new Date(stateRow.updated_at).getTime()
    if (Date.now() - lastUpdate < 60_000) return
  }

  if (state === 'linked') {
    await sendWhatsAppMessage(
      jid,
      `Hi ${displayName}! Your WhatsApp is linked to your Member Market account. Post business needs in the group chat and they'll be automatically added to the board. Visit your dashboard at ${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/dashboard`
    )
    return
  }

  if (state === 'awaiting_verification') {
    await sendWhatsAppMessage(
      jid,
      `Please check your email for the link we sent you — click it to complete linking your account to Member Market.`
    )
    return
  }

  // state === 'awaiting_reply': look for an email address
  const trimmed = messageText.trim()
  if (EMAIL_RE.test(trimmed)) {
    // They sent an email — mint a token and send the link email
    const { data: shadowUser } = await dbAny
      .from('shadow_users')
      .select('id')
      .eq('whatsapp_jid', jid)
      .maybeSingle() as { data: { id: string } | null }

    if (!shadowUser) {
      await sendWhatsAppMessage(
        jid,
        `We couldn't find your WhatsApp account in our system. Please post a need in the group chat first, then reply here with your email.`
      )
      return
    }

    const tokenResult = await mintLinkToken(shadowUser.id, trimmed)
    if (!tokenResult.ok || !tokenResult.token) {
      await sendWhatsAppMessage(
        jid,
        `Something went wrong generating your link. Please try again in a few minutes.`
      )
      return
    }

    await sendLinkEmail(trimmed, tokenResult.token)

    await sendWhatsAppMessage(
      jid,
      `We've sent a link to ${trimmed}. Click it to connect your WhatsApp to your Member Market account. The link expires in 24 hours.`
    )

    await upsertDmState(dbAny, { jid, state: 'awaiting_verification' })
  } else {
    // Not an email — prompt them
    await sendWhatsAppMessage(
      jid,
      `Hi ${displayName}! To link your WhatsApp to Member Market, reply with your Member Market email address and we'll send you a link.`
    )
    await upsertDmState(dbAny, { jid, state: 'awaiting_reply' })
  }
}

async function upsertDmState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbAny: any,
  input: { jid: string; state: DmState }
): Promise<void> {
  try {
    await dbAny
      .from('whatsapp_dm_state')
      .upsert(
        { jid: input.jid, state: input.state, updated_at: new Date().toISOString() },
        { onConflict: 'jid' }
      )
  } catch (err) {
    console.error('[dm-flow] upsertDmState failed:', err)
  }
}
