import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OnboardingForm } from '@/components/auth/onboarding-form'
import chaptersData from '@/lib/data/eo-chapters.json'
import type { Chapter } from '@/components/forms/chapter-picker'
import type { Profile } from '@/types/database'

const CHAPTERS = chaptersData as Chapter[]

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, eo_chapter, eo_membership_type, region, chapter_country, chapter_city')
    .eq('id', user.id)
    .single() as {
      data: (Pick<Profile, 'id' | 'full_name' | 'eo_chapter' | 'eo_membership_type'> & {
        region: string | null
        chapter_country: string | null
        chapter_city: string | null
      }) | null
    }

  // Already onboarded? Skip to business wizard or app.
  if (profile?.eo_membership_type && profile?.region) {
    // .limit(1) instead of .maybeSingle() — the latter returns null for
    // both 0 and >=2 rows. Multi-business users were getting bounced to
    // /dashboard/business/new instead of /marketplace.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: businesses } = await (supabase as any)
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1) as { data: Array<{ id: string }> | null }
    redirect(businesses && businesses.length > 0 ? '/marketplace' : '/dashboard/business/new')
  }

  return (
    <OnboardingForm
      chapters={CHAPTERS}
      defaultName={profile?.full_name ?? user.user_metadata?.full_name ?? ''}
      defaultChapter={profile?.eo_chapter ?? ''}
      defaultMembershipType={profile?.eo_membership_type ?? ''}
    />
  )
}
