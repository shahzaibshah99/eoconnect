import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BusinessEditForm } from '@/components/forms/business-edit-form'
import { ListingPauseButton } from '@/components/business/listing-pause-button'
import type { Business, Category } from '@/types/database'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditMyBusinessPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [{ data: business }, { data: categories }] = await Promise.all([
    db.from('businesses').select('*').eq('id', id).maybeSingle(),
    db.from('categories').select('*').eq('active', true).order('sort_order'),
  ])

  if (!business) notFound()
  if (business.owner_id !== user.id) notFound()

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link href="/dashboard/business/edit" className="text-xs text-muted-foreground hover:text-foreground inline-block mb-1">
            ← My Businesses
          </Link>
          <h1 className="text-2xl font-bold">Edit {business.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">Changes go live immediately.</p>
        </div>
        <Link
          href={`/marketplace/${business.id}`}
          className={cn(buttonVariants({ variant: 'outline' }), 'shrink-0')}
        >
          View Listing
        </Link>
      </div>
      <div className="mb-6">
        <ListingPauseButton
          businessId={business.id}
          status={business.status}
          pausedBy={business.paused_by ?? null}
        />
      </div>

      <BusinessEditForm
        business={business as Business}
        categories={(categories ?? []) as Category[]}
      />
    </div>
  )
}
