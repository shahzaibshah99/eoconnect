import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { assignMarketTags } from '@/lib/ai/assign-market-tags'

// One-shot endpoint to bulk-assign taxonomy tags to existing businesses.
//
// Auth: SUPABASE_SERVICE_ROLE_KEY in Authorization header.
//
// Usage:
//   curl -X POST https://<host>/api/admin/backfill-market-tags?batch=25 \
//        -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"
//
// Call repeatedly until remaining = 0.

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const batchSize = Math.min(parseInt(url.searchParams.get('batch') ?? '25'), 100)

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  const { data: pending } = await dbAny.rpc('businesses_missing_market_tags', { batch_size: batchSize }) as {
    data: Array<{ id: string }> | null
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ processed: 0, remaining: 0 })
  }

  let processed = 0
  for (const b of pending) {
    try {
      await assignMarketTags(dbAny, b.id)
      processed++
    } catch (err) {
      console.error('[admin/backfill-market-tags] failed for', b.id, err)
    }
  }

  const { data: stillMissing } = await dbAny.rpc('businesses_missing_market_tags', { batch_size: 1 }) as {
    data: Array<{ id: string }> | null
  }
  return NextResponse.json({ processed, remaining: stillMissing?.length ?? 0 })
}
