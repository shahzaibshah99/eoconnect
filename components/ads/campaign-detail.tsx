'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Pause, Play, Trash2, Plus } from 'lucide-react'
import { pauseCampaign, resumeCampaign, deleteCampaignDraft, topUpCampaign } from '@/actions/ads'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { toast } from 'sonner'

interface Campaign {
  id: string
  format: 'banner' | 'sponsored_listing'
  goal: string | null
  status: string
  target_category_ids: string[] | null
  target_keywords: string[] | null
  budget_total: number | null
  spend_to_date: number
  bid_cpc: number
  daily_pacing_cap: number | null
  impressions: number
  clicks: number
  start_date: string | null
  end_date: string | null
  rejection_reason: string | null
  created_at: string
  business: { id: string; name: string }
}

interface ChartPoint {
  date: string
  impressions: number
  clicks: number
  spend: number
}

const STATUS_VARIANTS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  pending_review: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  active: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  paused: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  completed: 'bg-muted text-muted-foreground border-border',
  rejected: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
}

export function CampaignDetail({
  campaign,
  chart,
  paymentBanner,
}: {
  campaign: Campaign
  chart: ChartPoint[]
  paymentBanner: string | null
}) {
  const [isPending, startTransition] = useTransition()
  const [topUpAmount, setTopUpAmount] = useState('25')

  const ctr = campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : 0
  const budgetUsed = campaign.budget_total ? (campaign.spend_to_date / campaign.budget_total) * 100 : 0
  const remainingBudget = Math.max(0, Number(campaign.budget_total ?? 0) - Number(campaign.spend_to_date))

  const onTopUp = () => {
    const amount = Number(topUpAmount)
    if (amount < 10) { toast.error('Minimum top-up is $10'); return }
    startTransition(async () => {
      const result = await topUpCampaign(campaign.id, amount)
      if (result.error) toast.error(result.error)
      else if (result.checkout_url) window.location.href = result.checkout_url
    })
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <Link href="/dashboard/ads" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
          <ArrowLeft className="h-3 w-3" /> All Campaigns
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold capitalize">{campaign.format.replace('_', ' ')} Campaign</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Created {format(new Date(campaign.created_at), 'MMM d, yyyy')}</p>
          </div>
          <Badge className={cn('border capitalize', STATUS_VARIANTS[campaign.status] ?? STATUS_VARIANTS.draft)}>
            {campaign.status.replace('_', ' ')}
          </Badge>
        </div>
      </div>

      {paymentBanner === 'success' && (
        <Alert className="border-primary/40 bg-primary/10">
          <AlertDescription className="text-primary font-medium">
            Payment received. Your campaign is in review and will go live once approved.
          </AlertDescription>
        </Alert>
      )}
      {paymentBanner === 'topup-success' && (
        <Alert className="border-primary/40 bg-primary/10">
          <AlertDescription className="text-primary font-medium">Top-up applied to your budget.</AlertDescription>
        </Alert>
      )}
      {campaign.status === 'rejected' && campaign.rejection_reason && (
        <Alert variant="destructive">
          <AlertDescription>Rejected: {campaign.rejection_reason}</AlertDescription>
        </Alert>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Spend" value={`$${Number(campaign.spend_to_date).toFixed(2)}`} sub={`of $${Number(campaign.budget_total ?? 0).toFixed(2)}`} />
        <Stat label="Impressions" value={campaign.impressions.toLocaleString()} />
        <Stat label="Clicks" value={campaign.clicks.toLocaleString()} />
        <Stat label="CTR" value={`${ctr.toFixed(2)}%`} />
      </div>

      {/* Budget bar */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Budget used</span>
          <span className="font-medium">{budgetUsed.toFixed(1)}%</span>
        </div>
        <div className="h-2 bg-muted rounded overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${Math.min(100, budgetUsed)}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">${remainingBudget.toFixed(2)} remaining</p>
      </div>

      {/* Chart */}
      {chart.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-4">Performance (last 30 days)</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="impressions" stroke="#94a3b8" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="clicks" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Targeting */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-2 text-sm">
        <h3 className="font-semibold mb-2">Targeting</h3>
        <Row label="Bid per click" value={`$${Number(campaign.bid_cpc).toFixed(2)}`} />
        <Row label="Categories" value={`${campaign.target_category_ids?.length ?? 0} selected`} />
        <Row label="Keywords" value={(campaign.target_keywords ?? []).join(', ') || '—'} />
        {campaign.daily_pacing_cap && <Row label="Daily cap" value={`$${campaign.daily_pacing_cap}`} />}
        {campaign.start_date && <Row label="Start" value={campaign.start_date} />}
        {campaign.end_date && <Row label="End" value={campaign.end_date} />}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {campaign.status === 'active' && (
          <Button variant="outline" disabled={isPending} onClick={() => startTransition(async () => {
            const r = await pauseCampaign(campaign.id); if (r.error) toast.error(r.error); else toast.success('Campaign paused')
          })} className="gap-1.5">
            <Pause className="h-4 w-4" /> Pause
          </Button>
        )}
        {campaign.status === 'paused' && (
          <Button disabled={isPending} onClick={() => startTransition(async () => {
            const r = await resumeCampaign(campaign.id); if (r.error) toast.error(r.error); else toast.success('Campaign resumed')
          })} className="gap-1.5 bg-primary text-primary-foreground">
            <Play className="h-4 w-4" /> Resume
          </Button>
        )}
        {campaign.status === 'draft' && (
          <ConfirmDialog
            trigger={
              <Button variant="outline" disabled={isPending} className="gap-1.5 text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" /> Delete Draft
              </Button>
            }
            title="Delete this draft?"
            description="The draft and any unspent budget will be removed. You can always create a new campaign later."
            confirmLabel="Delete draft"
            onConfirm={async () => {
              const r = await deleteCampaignDraft(campaign.id)
              if (r.error) {
                toast.error(r.error)
                throw new Error(r.error)
              }
              window.location.href = '/dashboard/ads'
            }}
          />
        )}
      </div>

      {/* Top up */}
      {['active', 'paused'].includes(campaign.status) && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div>
            <h3 className="font-semibold text-sm">Top up budget</h3>
            <p className="text-xs text-muted-foreground mt-1">Add to your campaign&apos;s total budget. Minimum $10.</p>
          </div>
          <div className="flex gap-2 max-w-sm">
            <div className="flex-1">
              <Label htmlFor="topup" className="sr-only">Amount</Label>
              <Input id="topup" type="number" min="10" value={topUpAmount} onChange={e => setTopUpAmount(e.target.value)} />
            </div>
            <Button onClick={onTopUp} disabled={isPending} className="gap-1.5 bg-primary text-primary-foreground">
              <Plus className="h-4 w-4" /> Add Funds
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
