'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { submitReview } from '@/actions/reviews'
import { cn } from '@/lib/utils'

interface ReviewFormProps {
  businessId: string
  existing?: { rating: number; body: string | null } | null
}

export function ReviewForm({ businessId, existing }: ReviewFormProps) {
  const router = useRouter()
  const [rating, setRating] = useState(existing?.rating ?? 0)
  const [hover, setHover] = useState(0)
  const [body, setBody] = useState(existing?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (rating < 1) { setError('Please select a rating'); return }
    setError(null)
    setSuccess(false)
    const fd = new FormData()
    fd.set('business_id', businessId)
    fd.set('rating', String(rating))
    fd.set('body', body)
    startTransition(async () => {
      const result = await submitReview(fd)
      if (result.error) {
        setError(result.error)
        return
      }
      setSuccess(true)
      // Pull the new review into the list immediately. Without this,
      // submitReview's revalidatePath on the server only invalidates
      // the route cache — the already-mounted client tree stays as it
      // was, so Andrew (and any reviewer) submitted successfully but
      // saw "No reviews yet" stick around and assumed nothing happened.
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="font-semibold">{existing ? 'Update your review' : 'Leave a review'}</h3>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {success && (
        // Same contrast rule as the rest of the app: subtle green tint
        // on the surface, but the actual confirmation text uses the
        // foreground colour so it's always legible regardless of how
        // the browser composites the translucent green. Pre-fix Andrew
        // hit submit and saw a green block with no readable text and
        // assumed nothing happened.
        <Alert className="border-primary/50 bg-primary/10 text-foreground">
          <AlertDescription className="text-foreground font-medium">
            Review {existing ? 'updated' : 'submitted'}.
          </AlertDescription>
        </Alert>
      )}

      <div>
        <p className="text-sm font-medium mb-2">Rating</p>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(n)}
              className="p-1"
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

      <div>
        <p className="text-sm font-medium mb-2">Your review</p>
        <Textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Share your experience working with this business (20-500 characters)…"
          rows={4}
          maxLength={500}
        />
        <p className="text-xs text-muted-foreground mt-1">{body.length}/500</p>
      </div>

      <Button type="submit" disabled={isPending} className="bg-primary text-primary-foreground font-bold">
        {isPending ? 'Submitting…' : existing ? 'Update Review' : 'Submit Review'}
      </Button>
    </form>
  )
}
