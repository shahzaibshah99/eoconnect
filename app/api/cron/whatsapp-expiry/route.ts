import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY not set' }, { status: 503 })
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  const now = new Date().toISOString()

  // Archive WhatsApp posts whose expires_at has passed and are still open
  const { data: archived, error: archiveErr } = await dbAny
    .from('bulletin_posts')
    .update({ status: 'archived' })
    .eq('status', 'open')
    .eq('source', 'whatsapp')
    .lt('expires_at', now)
    .select('id') as { data: Array<{ id: string }> | null; error: { message: string } | null }

  if (archiveErr) {
    console.error('[whatsapp-expiry] archive failed:', archiveErr.message)
    return NextResponse.json({ ok: false, error: archiveErr.message }, { status: 500 })
  }

  // Clean up expired, unused link tokens
  const { data: deletedTokens, error: tokenErr } = await dbAny
    .from('whatsapp_link_tokens')
    .delete()
    .lt('expires_at', now)
    .is('consumed_at', null)
    .select('id') as { data: Array<{ id: string }> | null; error: { message: string } | null }

  if (tokenErr) {
    console.error('[whatsapp-expiry] token cleanup failed:', tokenErr.message)
  }

  return NextResponse.json({
    ok: true,
    postsArchived: archived?.length ?? 0,
    tokensDeleted: deletedTokens?.length ?? 0,
  })
}
