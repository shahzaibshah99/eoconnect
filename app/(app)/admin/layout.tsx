import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, Tags, MessageSquareWarning, Building2, Megaphone, LayoutDashboard, ShieldCheck, History, MapPin, Upload, Flag, Star, Mail, ClipboardList } from 'lucide-react'
import { ADS_ENABLED } from '@/lib/feature-flags'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: 'member' | 'chapter_admin' | 'super_admin' } | null }

  if (!profile || !['chapter_admin', 'super_admin'].includes(profile.role)) {
    redirect('/dashboard')
  }

  const isSuper = profile.role === 'super_admin'

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
      <aside>
        <div className="sticky top-24 bg-card border border-border rounded-xl p-3 space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground px-2 py-1.5">
            {isSuper ? 'Super Admin' : 'Chapter Admin'}
          </p>
          <Link href="/admin" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
            <LayoutDashboard className="h-4 w-4" /> Overview
          </Link>
          <Link href="/admin/members" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
            <Users className="h-4 w-4" /> Members
          </Link>
          <Link href="/admin/listings" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
            <Building2 className="h-4 w-4" /> Listings
          </Link>
          <Link href="/admin/reviews" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
            <MessageSquareWarning className="h-4 w-4" /> Flagged Reviews
          </Link>
          <Link href="/admin/flags" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
            <Flag className="h-4 w-4" /> Flag review
          </Link>
          <Link href="/admin/imports" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
            <Upload className="h-4 w-4" /> CSV imports
          </Link>
          <Link href="/admin/claims" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
            <ClipboardList className="h-4 w-4" /> Claims tracker
          </Link>
          <Link href="/admin/email-log" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
            <Mail className="h-4 w-4" /> Email log
          </Link>
          {isSuper && (
            <Link href="/admin/verifications" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
              <ShieldCheck className="h-4 w-4" /> Verifications
            </Link>
          )}
          {isSuper && (
            <Link href="/admin/spotlight" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
              <Star className="h-4 w-4" /> Spotlight
            </Link>
          )}
          {isSuper && (
            <Link href="/admin/chapters" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
              <MapPin className="h-4 w-4" /> Chapters
            </Link>
          )}
          {isSuper && (
            <Link href="/admin/audit" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
              <History className="h-4 w-4" /> Audit log
            </Link>
          )}
          {ADS_ENABLED && (
            <Link href="/admin/ads" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
              <Megaphone className="h-4 w-4" /> Ad Approvals
            </Link>
          )}
          {isSuper && (
            <Link href="/admin/categories" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted">
              <Tags className="h-4 w-4" /> Categories
            </Link>
          )}
        </div>
      </aside>
      <div>{children}</div>
    </div>
  )
}
