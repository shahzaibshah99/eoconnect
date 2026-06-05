import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { assignMarketTags } from '@/lib/ai/assign-market-tags'

// Vercel Cron — fires daily at 03:47 UTC (see vercel.json).
// Finds published businesses with no taxonomy tags and assigns them.
// maxDuration 300s — tagging 50 businesses takes ~2 AI calls each.

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: false, message: 'Required env vars not set' }, { status: 503 })
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  const { data: pending } = await dbAny.rpc('businesses_missing_market_tags', { batch_size: 50 }) as {
    data: Array<{ id: string }> | null
  }

  let processed = 0
  for (const b of pending ?? []) {
    try {
      await assignMarketTags(dbAny, b.id)
      processed++
    } catch (err) {
      console.error('[cron/backfill-market-tags] failed for', b.id, err)
    }
  }

  return NextResponse.json({ ok: true, processed })
}
