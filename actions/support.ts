'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { sendEmail, supportInquiryEmail } from '@/lib/email/send'

const SUPPORT_INBOX = process.env.SUPPORT_INBOX_EMAIL?.trim() || 'support@member.market'

const SupportSchema = z.object({
  subject: z.string().trim().min(3, 'Subject is too short').max(120, 'Subject is too long'),
  body: z.string().trim().min(10, 'Please describe your question (at least 10 characters)').max(5000, 'Message is too long (max 5000 characters)'),
})

export interface SupportInquiryResult {
  error: string | null
}

/**
 * Send a support inquiry to support@member.market on behalf of the
 * signed-in member.
 *
 * The action looks up the member's profile server-side (id / name /
 * email / chapter) so the form on the client only has to collect the
 * subject and body — nothing the member fills in determines who the
 * email is "from", which means a malicious client can't impersonate
 * another member's identity in the inquiry header.
 *
 * Reply-To is set to the member's eo_membership_email so the support
 * team can reply directly. If the member has no email on file the
 * Reply-To is omitted and support has to look them up by ID.
 */
export async function submitSupportInquiry(formData: FormData): Promise<SupportInquiryResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please sign in to contact support.' }

  const parsed = SupportSchema.safeParse({
    subject: formData.get('subject'),
    body: formData.get('body'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: profile } = await db
    .from('profiles')
    .select('full_name, eo_membership_email, eo_chapter')
    .eq('id', user.id)
    .single() as {
      data: { full_name: string | null; eo_membership_email: string | null; eo_chapter: string | null } | null
    }

  const memberContext = {
    id: user.id,
    full_name: profile?.full_name ?? user.email?.split('@')[0] ?? 'Member',
    email: profile?.eo_membership_email ?? user.email ?? null,
    chapter: profile?.eo_chapter ?? null,
  }

  const tpl = supportInquiryEmail({
    member: memberContext,
    subject: parsed.data.subject,
    body: parsed.data.body,
  })

  const result = await sendEmail({
    to: SUPPORT_INBOX,
    subject: tpl.subject,
    html: tpl.html,
    replyTo: memberContext.email ?? undefined,
  })

  if (!result.ok) {
    // Don't leak the raw SMTP error to the user — just tell them it
    // didn't go through. The detailed error is in the server log.
    console.error('[support] sendEmail failed:', result.error)
    return { error: 'Could not send your message right now. Please try again in a minute.' }
  }

  return { error: null }
}
