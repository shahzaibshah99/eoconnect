import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PostWizard } from '@/components/bulletin/post-wizard'

export const dynamic = 'force-dynamic'

export default async function NewCommunityPostPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link href="/bulletin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Needs &amp; Asks
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Post a Community Ask</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Describe what you need — AI will generate a title and notify verified members in your area.
        </p>
      </div>
      <PostWizard boardType="community" />
    </div>
  )
}
