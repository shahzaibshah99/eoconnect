import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, Upload, LayoutDashboard, BadgeCheck, Star, ArrowRightLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Chapter Manager panel layout.
 *
 * Access model: a CM is a regular member with one or more rows in the
 * `chapter_managers` table. This layout queries those rows and gates
 * access by their existence — the user keeps their member role and
 * dashboard, the CM panel is purely additive.
 *
 * Multi-chapter support: the layout doesn't pin a chapter here. Each
 * page in this section reads `chapter_id` from the route param and
 * verifies the current user manages that chapter. Listing all
 * managed chapters is the dashboard's job (/chapter-manager).
 */
export default async function ChapterManagerLayout({
  children,
}: { children: React.ReactNode }) {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: assignments } = await db
    .from('chapter_managers')
    .select('chapter_id, eo_chapters!chapter_id (id, name, country, city)')
    .eq('member_id', user.id) as {
      data: Array<{
        chapter_id: number
        eo_chapters: { id: number; name: string; country: string | null; city: string | null } | null
      }> | null
    }

  if (!assignments || assignments.length === 0) {
    redirect('/dashboard')
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
      <aside>
        <div className="sticky top-24 bg-card border border-border rounded-xl p-3 space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground px-2 py-1.5">
            Chapter Manager
          </p>
          <Link
            href="/chapter-manager"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted"
          >
            <LayoutDashboard className="h-4 w-4" /> Overview
          </Link>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-3 pt-3 pb-1">
            Your chapters
          </p>
          {assignments.map(a => (
            a.eo_chapters && (
              <ChapterSection
                key={a.chapter_id}
                id={a.chapter_id}
                name={a.eo_chapters.name}
              />
            )
          ))}
        </div>
      </aside>
      <div>{children}</div>
    </div>
  )
}

function ChapterSection({ id, name }: { id: number; name: string }) {
  return (
    <div className="space-y-0.5 pb-1">
      <p className="px-3 pt-1 pb-0.5 text-xs font-medium truncate" title={name}>{name}</p>
      <Link
        href={`/chapter-manager/${id}/members`}
        className="flex items-center gap-2 px-5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <Users className="h-3.5 w-3.5" /> Members
      </Link>
      <Link
        href={`/chapter-manager/${id}/endorse`}
        className="flex items-center gap-2 px-5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <BadgeCheck className="h-3.5 w-3.5" /> Endorse
      </Link>
      <Link
        href={`/chapter-manager/${id}/imports`}
        className="flex items-center gap-2 px-5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <Upload className="h-3.5 w-3.5" /> CSV import
      </Link>
      <Link
        href={`/chapter-manager/${id}/sponsors`}
        className="flex items-center gap-2 px-5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <Star className="h-3.5 w-3.5" /> Sponsors
      </Link>
      <Link
        href={`/chapter-manager/${id}/transfer`}
        className="flex items-center gap-2 px-5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer listings
      </Link>
    </div>
  )
}
