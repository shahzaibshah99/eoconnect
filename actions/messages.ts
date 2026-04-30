'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { sendEmail, newMessageEmail } from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'

const ConversationSchema = z.object({
  owner_id: z.string().uuid('Invalid owner'),
  business_id: z.string().uuid('Invalid business'),
})

const InquirySchema = z.object({
  owner_id: z.string().uuid('Invalid owner'),
  business_id: z.string().uuid('Invalid business'),
  service_id: z.string().uuid().nullable().optional(),
  body: z.string().trim().min(1, 'Message is required').max(5000),
})

const CHAT_ATTACHMENT_MAX_BYTES = 12 * 1024 * 1024

// Body min(1) is intentionally relaxed: a message with no body but an
// attachment is valid. The two refines below enforce that
//   (a) at least one of body/attachment is non-empty, and
//   (b) attachment metadata is all-or-nothing — no half-populated rows.
const MessageSchema = z
  .object({
    conversation_id: z.string().uuid(),
    body: z.string().trim().max(5000),
    attachment_url: z.string().url().optional(),
    attachment_name: z.string().max(255).optional(),
    attachment_mime: z.string().max(127).optional(),
    attachment_size: z.coerce.number().int().positive().max(CHAT_ATTACHMENT_MAX_BYTES).optional(),
  })
  .refine(
    (v) => (v.body && v.body.length > 0) || !!v.attachment_url,
    { message: 'Message cannot be empty' }
  )
  .refine(
    (v) => !v.attachment_url || (!!v.attachment_name && !!v.attachment_mime && !!v.attachment_size),
    { message: 'Attachment metadata is incomplete' }
  )

export async function sendMessage(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Optional attachment fields come through as empty strings from the
  // form when no file was picked — coerce those to undefined so the
  // schema's optional() works as expected.
  const attachmentUrl = (formData.get('attachment_url') as string | null) || undefined
  const attachmentName = (formData.get('attachment_name') as string | null) || undefined
  const attachmentMime = (formData.get('attachment_mime') as string | null) || undefined
  const attachmentSizeRaw = (formData.get('attachment_size') as string | null) || undefined

  const parsed = MessageSchema.safeParse({
    conversation_id: formData.get('conversation_id'),
    body: formData.get('body') ?? '',
    attachment_url: attachmentUrl,
    attachment_name: attachmentName,
    attachment_mime: attachmentMime,
    attachment_size: attachmentSizeRaw,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { data: conv } = await db
    .from('conversations')
    .select('participant_ids')
    .eq('id', parsed.data.conversation_id)
    .single()

  if (!conv || !conv.participant_ids.includes(user.id)) {
    return { error: 'Not a participant in this conversation' }
  }

  const { error } = await db.from('messages').insert({
    conversation_id: parsed.data.conversation_id,
    sender_id: user.id,
    body: parsed.data.body,
    attachment_url: parsed.data.attachment_url ?? null,
    attachment_name: parsed.data.attachment_name ?? null,
    attachment_mime: parsed.data.attachment_mime ?? null,
    attachment_size: parsed.data.attachment_size ?? null,
  })

  if (error) return { error: error.message }

  // Notification email — runs after the response is flushed so the action
  // returns fast for the UI, but the runtime keeps the worker alive until
  // the SMTP send actually completes.
  after(async () => {
    try {
      const otherIds = (conv.participant_ids as string[]).filter((id: string) => id !== user.id)
      if (otherIds.length === 0) return
      const { data: senderProfile } = await db.from('profiles').select('full_name').eq('id', user.id).single()
      const { data: recipient } = await db
        .from('profiles')
        .select('eo_membership_email, full_name')
        .eq('id', otherIds[0])
        .single() as { data: { eo_membership_email: string | null; full_name: string } | null }
      if (!recipient?.eo_membership_email) {
        console.warn('[email] message recipient has no eo_membership_email — skipping notification')
        return
      }

      let businessName: string | null = null
      const { data: convRow } = await db.from('conversations').select('listing_id').eq('id', parsed.data.conversation_id).single()
      if (convRow?.listing_id) {
        const { data: biz } = await db.from('businesses').select('name').eq('id', convRow.listing_id).single()
        businessName = biz?.name ?? null
      }
      // Attachment-only messages would email a blank preview, which
      // looks broken. Fall back to a short "(sent an attachment: …)"
      // line so the recipient knows there's something to look at.
      const previewBody = parsed.data.body && parsed.data.body.length > 0
        ? parsed.data.body.slice(0, 200)
        : parsed.data.attachment_name
          ? `(sent an attachment: ${parsed.data.attachment_name})`
          : '(new message)'
      const tpl = newMessageEmail(senderProfile?.full_name ?? 'Someone', businessName, previewBody, siteUrl(), parsed.data.conversation_id)
      const result = await sendEmail({ to: recipient.eo_membership_email, subject: tpl.subject, html: tpl.html })
      if (result.ok) {
        console.log(`[email] message notification sent to ${recipient.eo_membership_email}`)
      } else {
        console.error('[email] message notification failed:', result.error)
      }
    } catch (err) {
      console.error('[email] message email send failed:', err)
    }
  })

  revalidatePath('/dashboard/messages')
  return { error: null }
}

/**
 * R2-06: Submit an inquiry from the listing page.
 *
 * Unlike `startConversation` (which silently created an empty thread and
 * redirected), this action creates/reuses the conversation AND sends the
 * member's first message in one shot. Returns a result so the modal can
 * confirm to the user before closing.
 *
 * If `service_id` is set, the message is prefixed with a small reference
 * line so the recipient knows which service the inquiry is about.
 */
export async function sendInquiry(input: {
  owner_id: string
  business_id: string
  service_id: string | null
  body: string
}): Promise<{ error: string | null; conversationId?: string }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please sign in to send an inquiry' }

  const parsed = InquirySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { owner_id, business_id, service_id, body } = parsed.data

  if (user.id === owner_id) {
    return { error: "You can't send an inquiry to your own listing" }
  }

  // Reuse an existing conversation about this listing if there is one.
  // Use .limit(1) — .maybeSingle() returns null for both "no rows" AND
  // ">=2 rows" cases. If a duplicate was ever created (race, manual
  // insert, etc.), every subsequent inquiry would fan out new dupes.
  const { data: existingRows } = await db
    .from('conversations')
    .select('id')
    .eq('listing_id', business_id)
    .contains('participant_ids', [user.id])
    .order('created_at', { ascending: true })
    .limit(1) as { data: Array<{ id: string }> | null }

  let conversationId = existingRows && existingRows.length > 0 ? existingRows[0].id : undefined
  if (!conversationId) {
    const { data: created, error: createErr } = await db
      .from('conversations')
      .insert({ participant_ids: [user.id, owner_id], listing_id: business_id })
      .select('id')
      .single() as { data: { id: string } | null; error: { message: string } | null }
    if (createErr || !created) return { error: createErr?.message ?? 'Failed to start conversation' }
    conversationId = created.id
  }

  // Optional service reference prepended to the message body.
  let messageBody = body
  if (service_id) {
    const { data: svc } = await db
      .from('services')
      .select('title')
      .eq('id', service_id)
      .maybeSingle() as { data: { title: string } | null }
    if (svc?.title) {
      messageBody = `Re: ${svc.title}\n\n${body}`
    }
  }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: messageBody,
  })
  if (msgErr) return { error: msgErr.message }

  // Post-response work: analytics + notification email.
  //
  // We use Next.js's after() instead of a fire-and-forget IIFE because the
  // serverless runtime will terminate as soon as the action returns —
  // unawaited promises can be killed before the SMTP send completes,
  // resulting in silent missed emails. after() keeps the request alive
  // until the callback resolves, then shuts down cleanly.
  const finalConversationId = conversationId
  after(async () => {
    try {
      await db.rpc('increment_listing_stat', {
        p_business_id: business_id,
        p_stat: 'contact_clicks',
      })
    } catch (err) {
      console.error('[analytics] contact_clicks rpc error:', err)
    }
    try {
      const { data: senderProfile } = await db.from('profiles').select('full_name').eq('id', user.id).single()
      const { data: recipient } = await db
        .from('profiles')
        .select('eo_membership_email, full_name')
        .eq('id', owner_id)
        .single() as { data: { eo_membership_email: string | null; full_name: string } | null }
      if (!recipient?.eo_membership_email) {
        console.warn('[email] inquiry recipient has no eo_membership_email — skipping notification')
        return
      }
      const { data: biz } = await db.from('businesses').select('name').eq('id', business_id).single()
      const tpl = newMessageEmail(
        senderProfile?.full_name ?? 'Someone',
        biz?.name ?? null,
        messageBody.slice(0, 200),
        siteUrl(),
        finalConversationId!
      )
      const result = await sendEmail({ to: recipient.eo_membership_email, subject: tpl.subject, html: tpl.html })
      if (result.ok) {
        console.log(`[email] inquiry notification sent to ${recipient.eo_membership_email}`)
      } else {
        console.error('[email] inquiry notification failed:', result.error)
      }
    } catch (err) {
      console.error('[email] inquiry email send failed:', err)
    }
  })

  revalidatePath('/dashboard/messages')
  return { error: null, conversationId }
}

export async function startConversation(formData: FormData) {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const parsed = ConversationSchema.safeParse({
    owner_id: formData.get('owner_id'),
    business_id: formData.get('business_id'),
  })
  if (!parsed.success) redirect('/marketplace')

  const { owner_id, business_id } = parsed.data

  if (user.id === owner_id) redirect('/dashboard/messages')

  // Check if this user already has a conversation about this listing.
  // Same .limit(1) pattern as sendInquiry — guards against the
  // .maybeSingle() 0-vs->=2 ambiguity creating duplicate threads.
  const { data: existingRows } = await db
    .from('conversations')
    .select('id')
    .eq('listing_id', business_id)
    .contains('participant_ids', [user.id])
    .order('created_at', { ascending: true })
    .limit(1) as { data: Array<{ id: string }> | null }

  if (existingRows && existingRows.length > 0) {
    redirect(`/dashboard/messages?conversation=${existingRows[0].id}`)
  }

  const { data: conversation, error } = await db
    .from('conversations')
    .insert({
      participant_ids: [user.id, owner_id],
      listing_id: business_id,
    })
    .select('id')
    .single()

  if (error || !conversation) redirect('/dashboard/messages')

  // Increment contact_clicks before redirecting so analytics is recorded.
  // Awaiting blocks the redirect by ~50ms but guarantees the RPC actually
  // fires (unawaited rpc() never executes in supabase-js + serverless).
  const { error: rpcErr } = await db.rpc('increment_listing_stat', {
    p_business_id: business_id,
    p_stat: 'contact_clicks',
  })
  if (rpcErr) console.error('[analytics] contact_clicks rpc error:', rpcErr)

  redirect(`/dashboard/messages?conversation=${conversation.id}`)
}
