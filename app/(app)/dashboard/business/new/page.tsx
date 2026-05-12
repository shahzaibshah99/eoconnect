import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BusinessProfileWizard } from '@/components/forms/business-profile-wizard'

export default async function NewBusinessPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [{ data: existing }, { data: categories }, { data: profile }] = await Promise.all([
    db.from('businesses').select('id', { count: 'exact', head: false }).eq('owner_id', user.id),
    supabase.from('categories').select('id, name, slug, icon, sort_order').eq('active', true).order('sort_order'),
    db.from('profiles').select('verification_tag').eq('id', user.id).maybeSingle() as Promise<{
      data: { verification_tag: string } | null
    }>,
  ])

  const existingCount = (existing as Array<{ id: string }> | null)?.length ?? 0
  const isUnverified = !profile?.verification_tag || profile.verification_tag === 'unverified'

  return (
    <div>
      {/* Verify-first banner — shown to new unverified users so they
          know they can verify before (or instead of) creating a listing.
          The proxy now exempts /dashboard/verify from the business gate
          so this link always works even with no business yet. */}
      {isUnverified && existingCount === 0 && (
        <div className="mb-8 bg-primary/5 border border-primary/20 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <ShieldCheck className="h-8 w-8 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Verify your membership first</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Verified members rank higher in search and unlock posting, messaging, and endorsements.
              You can verify before or after creating your listing.
            </p>
          </div>
          <Link
            href="/dashboard/verify"
            className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}
          >
            Verify now
          </Link>
        </div>
      )}

      <h1 className="text-2xl font-bold text-center mb-2">
        {existingCount > 0 ? 'Add Another Business' : 'Create Your Business Profile'}
      </h1>
      <p className="text-muted-foreground text-center mb-8">
        {existingCount > 0
          ? `You already have ${existingCount} business${existingCount === 1 ? '' : 'es'} listed. This will be a new, separate listing.`
          : 'List your business in the Member Market marketplace and start getting discovered.'}
      </p>
      <BusinessProfileWizard categories={(categories ?? []) as import('@/types/database').Category[]} />
    </div>
  )
}
