import { createClient as createServiceClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { MapPin } from 'lucide-react'

export const revalidate = 86400

export default async function ChaptersIndexPage() {
  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chapters } = await (db as any)
    .from('eo_chapters')
    .select('id, name, region, country, city')
    .order('region')
    .order('name') as {
    data: Array<{ id: number; name: string; region: string; country: string | null; city: string | null }> | null
  }

  const byRegion = new Map<string, typeof chapters>()
  for (const c of chapters ?? []) {
    const list = byRegion.get(c.region) ?? []
    list.push(c)
    byRegion.set(c.region, list)
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 space-y-10">
      <div>
        <h1 className="text-3xl font-bold">EO Chapters on Member Market</h1>
        <p className="text-muted-foreground mt-2">
          Browse chapter pages to see stats, active categories, and sponsor highlights.
        </p>
      </div>
      {Array.from(byRegion.entries()).map(([region, chaps]) => (
        <section key={region}>
          <h2 className="text-lg font-semibold mb-3 border-b border-border pb-2">{region}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {(chaps ?? []).map(c => (
              <Link
                key={c.id}
                href={`/chapters/${c.id}`}
                className="flex flex-col gap-1 bg-card border border-border rounded-xl p-4 hover:border-primary transition-colors"
              >
                <p className="font-medium text-sm">{c.name}</p>
                {(c.city || c.country) && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {[c.city, c.country].filter(Boolean).join(', ')}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
