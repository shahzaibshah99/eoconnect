import { createClient as createServiceClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { CheckCircle2, XCircle } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function ListingRemovePage({ params }: PageProps) {
  const { token } = await params

  if (!token || token.length !== 64 || !/^[a-f0-9]+$/.test(token)) {
    return <Result ok={false} message="Invalid removal link." />
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return <Result ok={false} message="Server configuration error." />
  }

  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  const { data: biz } = await dbAny
    .from('businesses')
    .select('id, name, status, claimed_at')
    .eq('removal_token', token)
    .maybeSingle() as { data: { id: string; name: string; status: string; claimed_at: string | null } | null }

  if (!biz) {
    return <Result ok={false} message="This removal link has already been used or is invalid." />
  }

  if (biz.claimed_at) {
    return <Result ok={false} message="This listing has been claimed by its owner and can no longer be removed via this link." />
  }

  if (biz.status === 'archived') {
    return <Result ok={true} message={`${biz.name} has already been removed.`} alreadyDone />
  }

  await dbAny
    .from('businesses')
    .update({
      status: 'archived',
      removal_token: null,
      claim_token: null,
      claim_token_expires_at: null,
    })
    .eq('id', biz.id)

  await dbAny.from('events_log').insert({
    type: 'listing_removed',
    entity_id: biz.id,
    metadata: { business_name: biz.name, reason: 'owner_opted_out' },
    tenant_id: 'eo',
  })

  return <Result ok={true} message={`${biz.name} has been removed from Member Market. You won't hear from us again.`} />
}

function Result({ ok, message, alreadyDone }: { ok: boolean; message: string; alreadyDone?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        {ok
          ? <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
          : <XCircle className="h-10 w-10 text-destructive mx-auto" />
        }
        <h1 className="text-xl font-bold">{ok ? (alreadyDone ? 'Already removed' : 'Listing removed') : 'Something went wrong'}</h1>
        <p className="text-muted-foreground text-sm">{message}</p>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>Go to Member Market</Link>
      </div>
    </div>
  )
}
