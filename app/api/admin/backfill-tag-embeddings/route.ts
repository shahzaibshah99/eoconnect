import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEmbedding } from '@/lib/ai/embeddings'

// One-shot endpoint to embed all market_tags rows in bulk.
// Run this before enabling the AI tagging pipeline to ensure
// vector candidate shortlisting works.
//
// Auth: SUPABASE_SERVICE_ROLE_KEY in Authorization header.
//
// Usage:
//   curl -X POST https://<host>/api/admin/backfill-tag-embeddings?batch=200 \
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
  const batchSize = Math.min(parseInt(url.searchParams.get('batch') ?? '200'), 500)

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  const { data: pending } = await dbAny
    .from('market_tags')
    .select('id, full_path, notes')
    .is('embedding', null)
    .limit(batchSize) as { data: Array<{ id: string; full_path: string; notes: string | null }> | null }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ processed: 0, remaining: 0 })
  }

  let processed = 0
  for (const tag of pending) {
    try {
      const text = tag.notes ? `${tag.full_path} ${tag.notes}` : tag.full_path
      const embedding = await getEmbedding(text)
      if (!embedding) continue

      await dbAny
        .from('market_tags')
        .update({ embedding, embedding_updated_at: new Date().toISOString() })
        .eq('id', tag.id)

      processed++
    } catch (err) {
      console.error('[admin/backfill-tag-embeddings] failed for', tag.id, err)
    }
  }

  const { count: remaining } = await dbAny
    .from('market_tags')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null) as { count: number | null }

  return NextResponse.json({ processed, remaining: remaining ?? 0 })
}
