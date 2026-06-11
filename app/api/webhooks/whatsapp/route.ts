import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { classifyMessage } from '@/services/whatsapp/classifier'
import { getOrCreateShadowUser } from '@/services/whatsapp/shadow-user'
import { createBulletinFromClassification } from '@/services/whatsapp/mm-client'
import { handleDmEvent } from '@/services/whatsapp/dm-flow'
import { sendWhatsAppMessage } from '@/services/whatsapp/waha-client'

export const maxDuration = 60

interface WahaPayload {
  id: string
  timestamp: number
  // For a GROUP message, `from` is the GROUP JID (...@g.us) and `participant`
  // is the individual sender (...@c.us or ...@lid). For a DIRECT message,
  // `from` is the sender (...@c.us) and `participant` is absent.
  from: string
  fromMe: boolean
  to?: string
  participant?: string
  body: string
  hasMedia: boolean
  _data?: { notifyName?: string }
}

interface WahaEvent {
  event: string
  session: string
  payload: WahaPayload
}

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(request: NextRequest) {
  // Validate WAHA shared secret
  const secret = request.headers.get('x-waha-secret')
  if (secret !== process.env.WAHA_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 })
  }

  let body: WahaEvent
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Only process message events; ignore own messages and media-only
  if (body.event !== 'message' || body.payload?.fromMe) {
    return NextResponse.json({ ok: true })
  }

  const payload = body.payload
  if (payload.hasMedia && !payload.body?.trim()) {
    return NextResponse.json({ ok: true })
  }

  const db = adminDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  // Kill-switch: check feature flag before doing anything
  const { data: flag } = await dbAny
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_name', 'whatsapp_agent_enabled')
    .maybeSingle() as { data: { is_enabled: boolean } | null }

  if (!flag?.is_enabled) {
    return NextResponse.json({ ok: true, skipped: 'agent_disabled' })
  }

  // Await processing before responding. The classifier (gpt-5-nano structured
  // output) takes ~10-15s; WAHA tolerates a slow webhook and retries on timeout.
  // Awaiting (rather than fire-and-forget) is reliable in both local dev and
  // serverless — fire-and-forget work gets torn down when the response is sent.
  // processMessage has its own top-level try/catch, so this never rejects.
  await processMessage(dbAny, payload)

  return NextResponse.json({ ok: true })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbAny: any,
  payload: WahaPayload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trace: Record<string, any> = { step: 'start', id: payload.id }
  console.log('[WAHA] processMessage started', payload.id)
  try {
    const messageText = payload.body?.trim() ?? ''
    const wahaMessageId = payload.id
    const configuredGroupJid = process.env.WAHA_GROUP_JID

    // WAHA puts the chat JID in `from`. For a group it ends in @g.us and the
    // individual sender is in `participant`; for a DM `from` IS the sender.
    const isGroupMessage = payload.from.endsWith('@g.us')

    // The individual person who sent the message — the one we DM back.
    const senderJid = isGroupMessage ? (payload.participant ?? '') : payload.from
    const senderName = payload._data?.notifyName ?? senderJid.split('@')[0]

    trace.route = isGroupMessage ? 'group' : 'dm'
    trace.chatJid = payload.from
    trace.senderJid = senderJid

    // Dedup: skip if we've already processed this message ID
    const { data: existing } = await dbAny
      .from('whatsapp_classification_log')
      .select('id')
      .eq('waha_message_id', wahaMessageId)
      .maybeSingle() as { data: { id: string } | null }

    if (existing) {
      trace.step = 'duplicate'
      return trace
    }

    if (isGroupMessage) {
      // Only process messages from the configured group (payload.from is the group JID)
      if (configuredGroupJid && payload.from !== configuredGroupJid) {
        trace.step = 'wrong_group'
        return trace
      }
      if (!senderJid) {
        trace.step = 'no_participant'
        console.error('[WAHA Error] group message without participant', wahaMessageId)
        return trace
      }
      await handleGroupMessage(dbAny, { senderJid, senderName, messageText, wahaMessageId, groupJid: payload.from }, trace)
    } else {
      await handleDmEvent({ jid: senderJid, messageText, displayName: senderName })
      trace.step = 'dm_handled'
    }
  } catch (err) {
    trace.step = 'threw'
    trace.error = err instanceof Error ? err.message : String(err)
    console.error('[WAHA Error] processMessage threw:', err)
  }
  console.log('[WAHA] processMessage done', { id: trace.id, step: trace.step, route: trace.route, postId: trace.bulletin?.postId })
  return trace
}

async function handleGroupMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbAny: any,
  input: {
    senderJid: string
    senderName: string
    messageText: string
    wahaMessageId: string
    groupJid: string | null
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trace: Record<string, any>
): Promise<void> {
  const { senderJid, senderName, messageText, wahaMessageId } = input

  let classification
  let classifyError: string | null = null

  try {
    classification = await classifyMessage(messageText)
    trace.classification = classification
  } catch (err) {
    classifyError = err instanceof Error ? err.message : String(err)
    trace.classifyError = classifyError
    console.error('[WAHA Error] classification failed:', classifyError)
  }

  // Log the classification (or error) — capture the insert error explicitly
  const { error: logErr } = await dbAny
    .from('whatsapp_classification_log')
    .insert({
      waha_message_id: wahaMessageId,
      message_text: messageText.slice(0, 2000),
      intent: classification?.intent ?? 'noise',
      confidence: classification?.confidence ?? 0,
      sensitive: classification?.sensitive ?? false,
      dropped: !classification || classification.intent === 'noise' || !!classifyError,
    })
  trace.logInsert = logErr ? `ERR: ${logErr.message}` : 'ok'
  if (logErr) console.error('[WAHA Error] log insert failed:', logErr.message)

  if (!classification || classification.intent === 'noise' || classifyError) {
    trace.step = 'stopped_not_need_lead'
    return
  }

  // Get or create shadow user
  const shadowUser = await getOrCreateShadowUser(senderJid, senderName, input.groupJid ?? undefined)
  trace.shadowUser = shadowUser ? { id: shadowUser.id, profile_id: shadowUser.profile_id } : null
  if (!shadowUser) {
    trace.step = 'shadow_user_failed'
    console.error('[WAHA Error] failed to get/create shadow user for', senderJid)
    return
  }

  const result = await createBulletinFromClassification({
    classification,
    shadowUserId: shadowUser.id,
    memberId: shadowUser.linked_user_id ?? shadowUser.profile_id,
  })
  trace.bulletin = result
  trace.step = 'done'

  // Update log with post_id
  if (result.postId) {
    const { error: updErr } = await dbAny
      .from('whatsapp_classification_log')
      .update({ post_id: result.postId, dropped: false })
      .eq('waha_message_id', wahaMessageId)
    if (updErr) {
      trace.logUpdate = `ERR: ${updErr.message}`
      console.error('[WAHA Error] log update failed:', updErr.message)
    }
  }

  // DM the individual poster (senderJid is the person's @c.us/@lid JID, NOT the
  // group) to confirm their need was posted.
  if (result.postId && senderJid) {
    const alreadyLinked = !!shadowUser.linked_user_id
    const matchLine = result.matchedCount > 0
      ? `I shared it with ${result.matchedCount} relevant ${result.matchedCount === 1 ? 'member' : 'members'} on Member Market.`
      : `I didn't find an immediate match, but it's live for members to respond to.`

    if (alreadyLinked) {
      // Already linked — just confirm the post, don't ask to link again and
      // DON'T reset DM state (leave it 'linked').
      const dmResult = await sendWhatsAppMessage(
        senderJid,
        `Hi ${senderName} 👋 I picked up your message in the group and posted it under your account. ${matchLine}`
      )
      trace.posterDm = dmResult.ok ? 'sent_linked' : `ERR: ${dmResult.error}`
    } else {
      // Not linked — confirm the post and invite them to link their account.
      const dmResult = await sendWhatsAppMessage(
        senderJid,
        `Hi ${senderName} 👋 I picked up your message in the group and posted it to Member Market. ${matchLine} Reply here with your email and I'll link this to your account.`
      )
      trace.posterDm = dmResult.ok ? 'sent' : `ERR: ${dmResult.error}`

      // Seed the DM flow state so a follow-up email reply links their account.
      await dbAny
        .from('whatsapp_dm_state')
        .upsert(
          { jid: senderJid, state: 'awaiting_reply', last_post_id: result.postId, updated_at: new Date().toISOString() },
          { onConflict: 'jid' }
        )
    }
  }
}
