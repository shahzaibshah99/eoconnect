import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { CheckCircle2, XCircle } from 'lucide-react'

function digestToken(memberId: string): string {
  const secret = process.env.CRON_SECRET ?? 'digest'
  return createHash('sha256').update(`${memberId}:${secret}`).digest('hex').slice(0, 32)
}

interface PageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function DigestUnsubscribePage({ searchParams }: PageProps) {
  const { token } = await searchParams
  if (!token || token.length !== 32) {
    return <ErrorPage message="Invalid unsubscribe link." />
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return <ErrorPage message="Server configuration error." />
  }

  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  // Find member whose token matches
  const { data: members } = await dbAny
    .from('profiles')
    .select('id, full_name, eo_membership_email')
    .not('eo_membership_email', 'is', null)
    .limit(5000) as { data: Array<{ id: string; full_name: string | null; eo_membership_email: string }> | null }

  const member = (members ?? []).find(m => digestToken(m.id) === token)
  if (!member) {
    return <ErrorPage message="Unsubscribe link not found or already used." />
  }

  // Check if already unsubscribed
  const { data: existing } = await dbAny
    .from('events_log')
    .select('id')
    .eq('type', 'digest_unsubscribed')
    .eq('member_id', member.id)
    .maybeSingle() as { data: { id: string } | null }

  if (!existing) {
    await dbAny.from('events_log').insert({
      type: 'digest_unsubscribed',
      member_id: member.id,
      metadata: { unsubscribed_at: new Date().toISOString() },
      tenant_id: 'eo',
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
        <h1 className="text-xl font-bold">You&apos;re unsubscribed</h1>
        <p className="text-muted-foreground text-sm">
          {member.full_name ? `${member.full_name}, you won't` : "You won't"} receive weekly digests anymore.
          You can re-subscribe any time from your dashboard settings.
        </p>
        <Link href="/dashboard" className={buttonVariants()}>Back to dashboard</Link>
      </div>
    </div>
  )
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <XCircle className="h-10 w-10 text-destructive mx-auto" />
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">{message}</p>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>Go home</Link>
      </div>
    </div>
  )
}
