import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEmbedding } from '@/lib/ai/embeddings'

// Vercel Cron — fires daily at 03:37 UTC (see vercel.json).
// Generates embeddings for market_tags rows that are missing them.
// Run until all ~5,000 tags have embeddings, then this cron becomes a no-op.

export const maxDuration = 60

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

  const { data: pending } = await dbAny
    .from('market_tags')
    .select('id, full_path, notes')
    .is('embedding', null)
    .limit(200) as { data: Array<{ id: string; full_path: string; notes: string | null }> | null }

  let processed = 0
  for (const tag of pending ?? []) {
    try {
      // Include notes in embedding text for richer semantic signal
      const text = tag.notes ? `${tag.full_path} ${tag.notes}` : tag.full_path
      const embedding = await getEmbedding(text)
      if (!embedding) continue

      await dbAny
        .from('market_tags')
        .update({ embedding, embedding_updated_at: new Date().toISOString() })
        .eq('id', tag.id)

      processed++
    } catch (err) {
      console.error('[cron/backfill-tag-embeddings] failed for', tag.id, err)
    }
  }

  return NextResponse.json({ ok: true, processed })
}
