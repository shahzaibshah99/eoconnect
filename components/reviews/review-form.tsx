'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Star, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { submitReview } from '@/actions/reviews'
import { cn } from '@/lib/utils'

interface ReviewFormProps {
  businessId: string
  /** The reviewer's already-submitted review on this business, if any.
   *  Drives the "you've already reviewed" non-editable view —
   *  members can't self-edit anymore. Admins edit through /admin. */
  existing?: { rating: number; body: string | null } | null
  /** Reviewer's own businesses — used to populate the
   *  "Reviewing as which of your businesses?" picker. Empty array
   *  hides the picker (member has no business; review still
   *  submits, just without that context). */
  reviewerBusinesses?: Array<{ id: string; name: string }>
  /** Services on the listing being reviewed — populates the service
   *  picker so the reviewer can call out which one specifically. */
  services?: Array<{ id: string; title: string }>
}

/**
 * Review submission form.
 *
 * Three states:
 *   1. existing review present → non-editable confirmation card.
 *      Members write reviews once. If they need a correction, the
 *      EO team can edit through /admin/reviews.
 *   2. no existing review, with optional business + service pickers
 *      → standard form. Pickers only render when there's something
 *      to pick (multiple businesses OR any services on the listing).
 *   3. submission success → flips to state 1 above on next render
 *      (router.refresh refetches the existing-review check).
 */
export function ReviewForm({
  businessId,
  existing,
  reviewerBusinesses = [],
  services = [],
}: ReviewFormProps) {
  const router = useRouter()
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [body, setBody] = useState('')
  const [reviewerBusinessId, setReviewerBusinessId] = useState<string>('')
  const [serviceId, setServiceId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // State 1: already submitted — show a clean confirmation card,
  // no edit affordance. Mirrors the pattern Andrew expected when he
  // hit submit and saw nothing change.
  if (existing) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-sm">You've reviewed this business</h3>
            <div className="flex gap-0.5 mt-1.5">
              {[1, 2, 3, 4, 5].map(n => (
                <Star
                  key={n}
                  className={cn(
                    'h-4 w-4',
                    n <= existing.rating ? 'fill-primary text-primary' : 'text-muted-foreground'
                  )}
                />
              ))}
            </div>
            {existing.body && (
              <p className="text-sm text-muted-foreground mt-2 italic">
                &ldquo;{existing.body}&rdquo;
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Reviews can&rsquo;t be edited. If something needs to change, contact the EO team.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (rating < 1) { setError('Please select a rating'); return }
    setError(null)
    const fd = new FormData()
    fd.set('business_id', businessId)
    fd.set('rating', String(rating))
    fd.set('body', body)
    if (reviewerBusinessId) fd.set('reviewer_business_id', reviewerBusinessId)
    if (serviceId) fd.set('service_id', serviceId)
    startTransition(async () => {
      const result = await submitReview(fd)
      if (result.error) {
        setError(result.error)
        return
      }
      // Success — refresh so the page re-fetches and this form
      // flips into the "already reviewed" state.
      router.refresh()
    })
  }

  // Single-business reviewers don't see the "as which business?"
  // picker — the choice is implicit. Auto-select on mount happens
  // through the controlled value being '' (falsy), which the action
  // treats as "no business specified". For single-business members
  // we *could* auto-fill it, but explicit-only is safer: it keeps
  // the schema honest about whether the reviewer made a choice.
  const showBusinessPicker = reviewerBusinesses.length > 1
  const showServicePicker = services.length > 0

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="font-semibold">Leave a review</h3>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <div>
        <Label className="text-sm font-medium mb-2 block">Rating</Label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(n)}
              className="p-1"
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
            >
              <Star
                className={cn(
                  'h-6 w-6 transition-colors',
                  n <= (hover || rating) ? 'fill-primary text-primary' : 'text-muted-foreground'
                )}
              />
            </button>
          ))}
        </div>
      </div>

      {showBusinessPicker && (
        <div>
          <Label htmlFor="reviewer_business_id" className="text-sm font-medium mb-2 block">
            Reviewing as <span className="text-muted-foreground font-normal">(your business)</span>
          </Label>
          <Select value={reviewerBusinessId} onValueChange={(v) => setReviewerBusinessId(v ?? '')}>
            <SelectTrigger id="reviewer_business_id">
              <SelectValue placeholder="Select your business…" />
            </SelectTrigger>
            <SelectContent>
              {reviewerBusinesses.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {showServicePicker && (
        <div>
          <Label htmlFor="service_id" className="text-sm font-medium mb-2 block">
            Service <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Select value={serviceId} onValueChange={(v) => setServiceId(v ?? '')}>
            <SelectTrigger id="service_id">
              <SelectValue placeholder="Which service did you use?" />
            </SelectTrigger>
            <SelectContent>
              {services.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="review-body" className="text-sm font-medium mb-2 block">Your review</Label>
        <Textarea
          id="review-body"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Share your experience working with this business (20-500 characters)…"
          rows={4}
          maxLength={500}
        />
        <p className="text-xs text-muted-foreground mt-1">{body.length}/500</p>
      </div>

      <Button type="submit" disabled={isPending} className="bg-primary text-primary-foreground font-bold">
        {isPending ? 'Submitting…' : 'Submit Review'}
      </Button>
    </form>
  )
}
