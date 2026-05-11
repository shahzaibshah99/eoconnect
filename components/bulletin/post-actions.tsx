'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markFulfilled, extendPost, updateReferralRelevance } from '@/actions/bulletin'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CheckCircle2, CalendarPlus, Sparkles } from 'lucide-react'
import type { ReferralSearchResult } from '@/lib/ai/referral-search'
import { cn } from '@/lib/utils'

interface PostActionsProps {
  postId: string
  boardType: 'business' | 'community'
  /** F18: AI referrals surfaced for this post — used in satisfaction prompt. */
  aiReferrals?: ReferralSearchResult[]
}

/**
 * Owner-only controls for managing the post lifecycle:
 *   - Mark fulfilled → satisfaction prompt (F18) → closes replies
 *   - Extend → adds 14 days to required_by for active but ongoing needs
 */
export function PostActions({ postId, boardType, aiReferrals = [] }: PostActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [satisfactionOpen, setSatisfactionOpen] = useState(false)
  const [selectedReferral, setSelectedReferral] = useState<string | null>(null)
  const [isVoting, startVote] = useTransition()

  const extend = () => {
    startTransition(async () => {
      await extendPost(postId)
      router.refresh()
    })
  }

  const doFulfill = async () => {
    const res = await markFulfilled(postId)
    if (res.error) throw new Error(res.error)
    // F18: if there are AI referrals, show the satisfaction prompt.
    // Otherwise just refresh.
    if (aiReferrals.length > 0) {
      setSatisfactionOpen(true)
    } else {
      router.refresh()
    }
  }

  const submitVote = (referralId: string | null) => {
    if (referralId) {
      startVote(async () => {
        await updateReferralRelevance(referralId, boardType)
        setSatisfactionOpen(false)
        router.refresh()
      })
    } else {
      setSatisfactionOpen(false)
      router.refresh()
    }
  }

  return (
    <>
      <div className="flex gap-2 pt-2 border-t border-border">
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="outline" className="gap-1.5" disabled={isPending}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Mark fulfilled
            </Button>
          }
          title="Mark this need as fulfilled?"
          description="This signals to the network that your need has been met. Replies will be frozen. This cannot be undone."
          confirmLabel="Mark fulfilled"
          variant="primary"
          onConfirm={doFulfill}
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={extend}
          disabled={isPending}
        >
          <CalendarPlus className="h-3.5 w-3.5" /> Extend 14 days
        </Button>
      </div>

      {/* F18 satisfaction prompt — only shown when AI referrals exist */}
      <Dialog open={satisfactionOpen} onOpenChange={open => { if (!open) { setSatisfactionOpen(false); router.refresh() } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Which suggestion helped most?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              The AI surfaced these from similar past posts. Your pick helps the network learn which referrals are most useful.
            </p>
            <div className="space-y-2">
              {aiReferrals.map(ref => (
                <button
                  key={ref.id}
                  type="button"
                  onClick={() => setSelectedReferral(ref.id)}
                  className={cn(
                    'w-full text-left p-3 rounded-lg border transition-colors',
                    selectedReferral === ref.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/40'
                  )}
                >
                  <p className="text-sm font-medium">{ref.referred_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ref.referred_category}{ref.referred_location ? ` · ${ref.referred_location}` : ''}
                  </p>
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => submitVote(selectedReferral)}
                disabled={isVoting}
                className="flex-1"
              >
                {isVoting ? 'Saving…' : selectedReferral ? 'Submit' : 'None of these'}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setSatisfactionOpen(false); router.refresh() }}
                disabled={isVoting}
              >
                Skip
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
