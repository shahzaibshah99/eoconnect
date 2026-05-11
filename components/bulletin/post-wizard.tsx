'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reviewPost, submitBulletinPost } from '@/actions/bulletin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Sparkles, ChevronRight, Loader2, CheckCircle2, Building2 } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface Category { id: string; name: string; slug: string }

interface FormState {
  title: string
  detail: string
  category: string
  geography_country: string
  geography_city: string
  required_by: string
}

interface PostWizardProps {
  categories: Category[]
}

type Step = 'form' | 'reviewing' | 'ai-feedback' | 'posting' | 'receipt'

/**
 * Two-step bulletin post wizard.
 *
 * Step 1 (form): member fills in title, category, geography, date, detail.
 * Step 2 (AI review): "Next →" fires reviewPost() — shows AI feedback
 *   inline. Member can address it or post anyway.
 * Step 3 (receipt): after submit, shows matched businesses.
 */
export function PostWizard({ categories }: PostWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('form')
  const [form, setForm] = useState<FormState>({
    title: '',
    detail: '',
    category: '',
    geography_country: '',
    geography_city: '',
    required_by: '',
  })
  const [aiFeedback, setAiFeedback] = useState<string | null>(null)
  const [aiTags, setAiTags] = useState<string[]>([])
  const [isComplete, setIsComplete] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [matched, setMatched] = useState<Array<{ id: string; name: string }>>([])
  const [postId, setPostId] = useState<string | null>(null)
  const [isReviewing, startReview] = useTransition()
  const [isPosting, startPost] = useTransition()

  const update = (k: keyof FormState, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  // Today's date as the min for required_by
  const today = new Date().toISOString().split('T')[0]

  const handleNext = () => {
    setError(null)
    if (!form.title.trim() || form.title.trim().length < 10) {
      setError('Title must be at least 10 characters')
      return
    }
    if (!form.category) { setError('Please select a category'); return }
    if (!form.geography_country.trim()) { setError('Country is required'); return }
    if (!form.required_by) { setError('Please set a required-by date'); return }

    setStep('reviewing')
    startReview(async () => {
      const res = await reviewPost(form)
      if (res.error) { setError(res.error); setStep('form'); return }
      setAiFeedback(res.feedback)
      setAiTags(res.tags)
      setIsComplete(res.is_complete)
      setStep('ai-feedback')
    })
  }

  const handlePost = () => {
    setError(null)
    setStep('posting')
    startPost(async () => {
      const res = await submitBulletinPost({
        ...form,
        tags: aiTags,
        board_type: 'business',
      })
      if (res.error) { setError(res.error); setStep('ai-feedback'); return }
      setMatched(res.matched_businesses ?? [])
      setPostId(res.post_id ?? null)
      setStep('receipt')
    })
  }

  if (step === 'receipt') {
    return (
      <div className="bg-card border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
          <div>
            <h2 className="font-semibold">Your need is posted</h2>
            <p className="text-sm text-muted-foreground">Verified members can now reply in the thread.</p>
          </div>
        </div>

        {matched.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              We notified {matched.length} matching {matched.length === 1 ? 'business' : 'businesses'}:
            </p>
            <ul className="space-y-1">
              {matched.map(b => (
                <li key={b.id}>
                  <Link
                    href={`/marketplace/${b.id}`}
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    {b.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {matched.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No businesses matched your tags yet — your post is live and members can still reply.
          </p>
        )}

        <div className="flex gap-2 pt-2">
          {postId && (
            <Button onClick={() => router.push(`/bulletin/${postId}`)}>
              View post &amp; thread →
            </Button>
          )}
          <Button variant="outline" onClick={() => router.push('/bulletin')}>
            Back to board
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-5">
      {/* ── Step indicator ── */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn('font-medium', step === 'form' ? 'text-foreground' : '')}>
          1. Details
        </span>
        <ChevronRight className="h-3 w-3" />
        <span className={cn('font-medium', step === 'ai-feedback' || step === 'reviewing' || step === 'posting' ? 'text-foreground' : '')}>
          2. AI review
        </span>
        <ChevronRight className="h-3 w-3" />
        <span>3. Post</span>
      </div>

      {/* ── AI feedback panel (step 2) ── */}
      {step === 'reviewing' && (
        <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
          Reviewing your post and extracting tags…
        </div>
      )}

      {step === 'posting' && (
        <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
          Posting and notifying matched businesses…
        </div>
      )}

      {(step === 'form' || step === 'ai-feedback') && (
        <>
          {/* ── Form ── */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">
                What do you need? <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                value={form.title}
                onChange={e => update('title', e.target.value)}
                placeholder="e.g. Experienced IP lawyer for startup trademark filing"
                maxLength={120}
                disabled={step === 'ai-feedback'}
              />
              <p className="text-[11px] text-muted-foreground text-right">{form.title.length}/120</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Category <span className="text-destructive">*</span></Label>
                <Select
                  value={form.category}
                  onValueChange={v => update('category', v ?? '')}
                  disabled={step === 'ai-feedback'}
                >
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => (
                      <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="required_by">
                  Needed by <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="required_by"
                  type="date"
                  value={form.required_by}
                  min={today}
                  onChange={e => update('required_by', e.target.value)}
                  disabled={step === 'ai-feedback'}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="country">Country <span className="text-destructive">*</span></Label>
                <Input
                  id="country"
                  value={form.geography_country}
                  onChange={e => update('geography_country', e.target.value)}
                  placeholder="e.g. Australia"
                  disabled={step === 'ai-feedback'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">City <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="city"
                  value={form.geography_city}
                  onChange={e => update('geography_city', e.target.value)}
                  placeholder="e.g. Sydney"
                  disabled={step === 'ai-feedback'}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="detail">
                More detail <span className="text-muted-foreground font-normal">(optional — helps with matching)</span>
              </Label>
              <Textarea
                id="detail"
                value={form.detail}
                onChange={e => update('detail', e.target.value)}
                placeholder="Budget range, specific requirements, timeline, anything that helps matching businesses understand if they're a fit…"
                rows={4}
                maxLength={2000}
                disabled={step === 'ai-feedback'}
                className="resize-none"
              />
              <p className="text-[11px] text-muted-foreground text-right">{form.detail.length}/2000</p>
            </div>
          </div>

          {/* ── AI review result (step 2 overlay) ── */}
          {step === 'ai-feedback' && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                AI review
              </div>

              {aiFeedback && !isComplete && (
                <Alert>
                  <AlertDescription>
                    <strong>Suggestion:</strong> {aiFeedback}
                    <br />
                    <span className="text-[11px] text-muted-foreground mt-1 block">
                      Completing this detail gives us the best chance of matching you with the right businesses.
                      You can post as-is or go back to edit.
                    </span>
                  </AlertDescription>
                </Alert>
              )}

              {(isComplete || !aiFeedback) && (
                <p className="text-sm text-green-700 dark:text-green-400">
                  ✓ Your post looks clear and specific.
                </p>
              )}

              {aiTags.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Tags extracted (used to match businesses):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {aiTags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-[11px]">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

          {/* ── Actions ── */}
          <div className="flex gap-2 pt-1">
            {step === 'form' && (
              <Button
                onClick={handleNext}
                disabled={isReviewing}
                className="gap-1.5"
              >
                {isReviewing
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Reviewing…</>
                  : <><Sparkles className="h-4 w-4" /> Next — AI review</>
                }
              </Button>
            )}

            {step === 'ai-feedback' && (
              <>
                <Button
                  onClick={handlePost}
                  disabled={isPosting}
                >
                  {isPosting ? 'Posting…' : 'Post & notify matches'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStep('form')}
                  disabled={isPosting}
                >
                  Edit
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
