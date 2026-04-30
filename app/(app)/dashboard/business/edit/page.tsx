import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

export default async function MyBusinessesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: businesses } = await db
    .from('businesses')
    .select('id, name, tagline, logo_url, status, paused_by, city, country, created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false }) as {
      data: Array<{
        id: string
        name: string
        tagline: string | null
        logo_url: string | null
        status: 'draft' | 'published' | 'paused'
        paused_by: 'owner' | 'admin' | null
        city: string | null
        country: string | null
        created_at: string
      }> | null
    }

  const list = businesses ?? []

  // Brand new user with no businesses → forward into onboarding-style wizard
  if (list.length === 0) redirect('/dashboard/business/new')

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">My Businesses</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Edit any of your listings, or add another business.
          </p>
        </div>
        <Link
          href="/dashboard/business/new"
          className={cn(buttonVariants(), 'bg-primary text-primary-foreground font-bold gap-1.5')}
        >
          <Plus className="h-4 w-4" /> Add Business
        </Link>
      </div>

      <div className="space-y-3">
        {list.map(b => (
          <Link
            key={b.id}
            href={`/dashboard/business/edit/${b.id}`}
            className="flex items-center gap-4 bg-card border border-border rounded-xl p-4 hover:border-primary transition-colors"
          >
            <div className="h-14 w-14 rounded-lg overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
              {b.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.logo_url} alt={b.name} className="w-full h-full object-cover" />
              ) : (
                <Building2 className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold">{b.name}</h3>
                <StatusBadge status={b.status} />
                {b.status === 'paused' && b.paused_by === 'admin' && (
                  <Badge className="border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px]">
                    Admin hold
                  </Badge>
                )}
              </div>
              {b.tagline && <p className="text-sm text-muted-foreground truncate mt-0.5">{b.tagline}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">
                {[b.city, b.country].filter(Boolean).join(', ') || 'No location'} · Created {format(new Date(b.created_at), 'MMM d, yyyy')}
              </p>
            </div>
            <span className="text-sm text-primary flex-shrink-0">Edit →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: 'draft' | 'published' | 'paused' }) {
  const styles: Record<string, string> = {
    published: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
    draft: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
    paused: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  }
  return <Badge className={cn('border capitalize text-[10px]', styles[status])}>{status}</Badge>
}
