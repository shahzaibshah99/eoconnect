'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitFlag } from '@/actions/flags'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Flag } from 'lucide-react'
import { cn } from '@/lib/utils'

type TargetType = 'listing' | 'post' | 'response' | 'review' | 'message'
type FlagType = 'solicitation' | 'spam' | 'inaccurate' | 'inappropriate'

const FLAG_OPTIONS: { value: FlagType; label: string; description: string }[] = [
  {
    value: 'solicitation',
    label: 'Unsolicited selling',
    description: 'Cold-pitch, spam DM, or sales approach outside of a genuine inquiry',
  },
  {
    value: 'spam',
    label: 'Spam',
    description: 'Repetitive, irrelevant, or bulk content',
  },
  {
    value: 'inaccurate',
    label: 'Inaccurate information',
    description: 'False claims about services, credentials, or membership',
  },
  {
    value: 'inappropriate',
    label: 'Inappropriate content',
    description: 'Offensive, discriminatory, or violates community standards',
  },
]

interface FlagDialogProps {
  targetType: TargetType
  targetId: string
  /** Friendly name shown in the dialog for context ("Acme Corp listing") */
  targetLabel?: string
  /** Compact trigger — just an icon. Full trigger = labelled button. */
  compact?: boolean
}

/**
 * Per scope F06: "Flag on all listings, posts, threads. Types: Solicitation /
 * Spam / Inaccurate / Inappropriate. 3 flags → admin queue auto-escalation."
 *
 * The submitted flag goes to the flags table via the submitFlag action.
 * The admin queue at /admin/flags picks it up. No member feedback on
 * who else flagged — we just confirm "thank you, we'll review."
 */
export function FlagDialog({
  targetType, targetId, targetLabel, compact = false,
}: FlagDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selectedType, setSelectedType] = useState<FlagType | null>(null)
  const [reason, setReason] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      // Reset on close so re-opening starts fresh.
      setSelectedType(null)
      setReason('')
      setSubmitted(false)
      setError(null)
    }
    setOpen(v)
  }

  const submit = () => {
    if (!selectedType) return
    setError(null)
    startTransition(async () => {
      const res = await submitFlag({
        target_type: targetType,
        target_id: targetId,
        type: selectedType,
        reason: reason.trim() || undefined,
      })
      if (res.error) { setError(res.error); return }
      setSubmitted(true)
      router.refresh()
    })
  }

  const trigger = compact ? (
    <button
      type="button"
      title="Flag this content"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
    >
      <Flag className="h-4 w-4" />
    </button>
  ) : (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
    >
      <Flag className="h-3.5 w-3.5" />
      Report
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger as React.ReactElement} />

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {submitted ? 'Thank you for reporting' : `Report${targetLabel ? ` "${targetLabel}"` : ''}`}
          </DialogTitle>
        </DialogHeader>

        {submitted ? (
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Our team will review this report. If it violates our community standards
              we&apos;ll take action. We don&apos;t share details of reports with other members.
            </p>
            <Button className="w-full" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                What&apos;s the issue? Reports are reviewed by our admin team. 3 reports
                from different members automatically escalates for priority review.
              </p>

              <div className="space-y-2">
                {FLAG_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedType(opt.value)}
                    className={cn(
                      'w-full text-left p-3 rounded-lg border transition-colors',
                      selectedType === opt.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/40'
                    )}
                  >
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                  </button>
                ))}
              </div>

              {selectedType && (
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-medium block">
                    Additional detail{' '}
                    <span className="text-muted-foreground font-normal">(optional, max 500 chars)</span>
                  </label>
                  <Textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Any specific detail that helps us review faster…"
                    rows={3}
                    maxLength={500}
                    className="resize-none"
                  />
                  <p className="text-[11px] text-muted-foreground text-right">{reason.length}/500</p>
                </div>
              )}

              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={!selectedType || isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isPending ? 'Submitting…' : 'Submit report'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
