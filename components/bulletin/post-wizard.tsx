'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reviewPost, submitBulletinPost } from '@/actions/bulletin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Sparkles, ChevronRight, Loader2, CheckCircle2, Building2, Users } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { ReferralSearchResult } from '@/lib/ai/referral-search'

// Convert kebab-case AI tag to a readable category label for the DB.
// e.g. "legal-services" → "Legal Services"
function tagToLabel(tag: string): string {
  return tag.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

interface FormState {
  detail: string
  geography_country: string
  geography_city: string
  required_by: string
}

interface PostWizardProps {
  boardType?: 'business' | 'community'
}

type Step = 'form' | 'reviewing' | 'ai-feedback' | 'posting' | 'receipt'

/**
 * Simplified two-step bulletin post wizard.
 *
 * Step 1 (form): member describes their need + picks location + date.
 * Step 2 (AI review): AI generates a title, extracts tags, and flags
 *   missing detail. Member can edit the title, then post.
 * Step 3 (receipt): shows matched businesses/members.
 */
export function PostWizard({ boardType = 'business' }: PostWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('form')
  const [form, setForm] = useState<FormState>({
    detail: '',
    geography_country: '',
    geography_city: '',
    required_by: '',
  })

  // AI-generated values — title is editable by the member before posting.
  const [suggestedTitle, setSuggestedTitle] = useState<string>('')
  const [aiFeedback, setAiFeedback] = useState<string | null>(null)
  const [aiTags, setAiTags] = useState<string[]>([])
  const [isComplete, setIsComplete] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const [matched, setMatched] = useState<Array<{ id: string; name: string }>>([])
  const [matchedMembers, setMatchedMembers] = useState<Array<{ id: string; name: string }>>([])
  const [aiReferrals, setAiReferrals] = useState<ReferralSearchResult[]>([])
  const [postId, setPostId] = useState<string | null>(null)
  const [isReviewing, startReview] = useTransition()
  const [isPosting, startPost] = useTransition()

  const update = (k: keyof FormState, v: string) => setForm(prev => ({ ...prev, [k]: v }))
  const today = new Date().toISOString().split('T')[0]

  const handleNext = () => {
    setError(null)
    if (!form.detail.trim() || form.detail.trim().length < 10) {
      setError('Please describe your need in at least 10 characters')
      return
    }
    if (!form.geography_country.trim()) { setError('Country is required'); return }
    if (!form.required_by) { setError('Please set a required-by date'); return }

    setStep('reviewing')
    startReview(async () => {
      const res = await reviewPost({
        detail: form.detail,
        geography_country: form.geography_country,
        geography_city: form.geography_city,
        required_by: form.required_by,
      })
      if (res.error) { setError(res.error); setStep('form'); return }
      setSuggestedTitle(res.suggested_title ?? '')
      setAiFeedback(res.feedback)
      setAiTags(res.tags)
      setIsComplete(res.is_complete)
      setStep('ai-feedback')
    })
  }

  const handlePost = () => {
    setError(null)
    if (!suggestedTitle.trim()) { setError('Title is required — edit the AI suggestion above'); return }
    setStep('posting')
    startPost(async () => {
      const res = await submitBulletinPost({
        title: suggestedTitle.trim(),
        detail: form.detail,
        category: aiTags[0] ? tagToLabel(aiTags[0]) : 'General',
        geography_country: form.geography_country,
        geography_city: form.geography_city,
        required_by: form.required_by,
        tags: aiTags,
        board_type: boardType,
      })
      if (res.error) { setError(res.error); setStep('ai-feedback'); return }
      setMatched(res.matched_businesses ?? [])
      setMatchedMembers(res.matched_members ?? [])
      setAiReferrals(res.ai_referrals ?? [])
      setPostId(res.post_id ?? null)
      setStep('receipt')
    })
  }

  if (step === 'receipt') {
    const isCommunity = boardType === 'community'
    const backHref = isCommunity ? '/community' : '/bulletin'
    return (
      <div className="bg-card border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
          <div>
            <h2 className="font-semibold">{isCommunity ? 'Your ask is posted' : 'Your need is posted'}</h2>
            <p className="text-sm text-muted-foreground">Verified members can now reply in the thread.</p>
          </div>
        </div>

        {isCommunity && matchedMembers.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              We notified {matchedMembers.length} {matchedMembers.length === 1 ? 'member' : 'members'} in your area:
            </p>
            <ul className="space-y-1">
              {matchedMembers.map(m => (
                <li key={m.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  {m.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isCommunity && matchedMembers.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No matching members found in your country yet — your ask is live and anyone can reply.
          </p>
        )}

        {!isCommunity && matched.length > 0 && (
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

        {!isCommunity && matched.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No businesses matched your tags yet — your post is live and members can still reply.
          </p>
        )}

        {aiReferrals.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              From similar past posts:
            </p>
            {aiReferrals.map(ref => (
              <div key={ref.id} className="text-xs bg-primary/5 border border-primary/20 rounded-lg p-2.5">
                <span className="font-medium">{ref.referred_name}</span>
                {ref.referred_category && <span className="text-muted-foreground"> — {ref.referred_category}</span>}
                {ref.referred_location && <span className="text-muted-foreground"> in {ref.referred_location}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {postId && (
            <Button onClick={() => router.push(`${backHref}/${postId}`)}>
              View post &amp; thread →
            </Button>
          )}
          <Button variant="outline" onClick={() => router.push(backHref)}>
            Back to board
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-5">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn('font-medium', step === 'form' ? 'text-foreground' : '')}>
          1. Describe
        </span>
        <ChevronRight className="h-3 w-3" />
        <span className={cn('font-medium', step === 'ai-feedback' || step === 'reviewing' || step === 'posting' ? 'text-foreground' : '')}>
          2. AI review
        </span>
        <ChevronRight className="h-3 w-3" />
        <span>3. Post</span>
      </div>

      {step === 'reviewing' && (
        <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
          AI is reading your post and generating a title…
        </div>
      )}

      {step === 'posting' && (
        <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
          Posting and notifying matched {boardType === 'community' ? 'members' : 'businesses'}…
        </div>
      )}

      {(step === 'form' || step === 'ai-feedback') && (
        <>
          <div className="space-y-4">
            {/* Description — primary input (always shown, locked after review) */}
            <div className="space-y-1.5">
              <Label htmlFor="detail">
                {boardType === 'community'
                  ? 'What do you need from the community?'
                  : 'What do you need?'}{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="detail"
                value={form.detail}
                onChange={e => update('detail', e.target.value)}
                placeholder={
                  boardType === 'community'
                    ? 'Describe what you are looking for — advice, contacts, recommendations, resources… The more detail, the better AI can match you.'
                    : 'Describe your need in detail — what you are looking for, budget range, timeline, specific requirements. AI will generate a title and tags from this.'
                }
                rows={5}
                maxLength={2000}
                disabled={step === 'ai-feedback'}
                className="resize-none"
              />
              <p className="text-[11px] text-muted-foreground text-right">{form.detail.length}/2000</p>
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
              <Label htmlFor="required_by">
                {boardType === 'community' ? 'Open until' : 'Needed by'}{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="required_by"
                type="date"
                value={form.required_by}
                min={today}
                onChange={e => update('required_by', e.target.value)}
                disabled={step === 'ai-feedback'}
                className="max-w-[200px]"
              />
            </div>
          </div>

          {/* AI review result — shown after AI processes the description */}
          {step === 'ai-feedback' && (
            <div className="space-y-4 border-t border-border pt-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                AI review
              </div>

              {/* Editable AI-generated title */}
              <div className="space-y-1.5">
                <Label htmlFor="ai-title">
                  Title{' '}
                  <span className="text-[11px] text-primary font-normal">(AI generated — edit if needed)</span>
                </Label>
                <Input
                  id="ai-title"
                  value={suggestedTitle}
                  onChange={e => setSuggestedTitle(e.target.value)}
                  maxLength={120}
                  placeholder="AI will generate a title from your description…"
                />
                <p className="text-[11px] text-muted-foreground text-right">{suggestedTitle.length}/120</p>
              </div>

              {/* Tags */}
              {aiTags.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Tags extracted (used for matching):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {aiTags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-[11px]">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Feedback */}
              {aiFeedback && !isComplete && (
                <Alert>
                  <AlertDescription>
                    <strong>Suggestion:</strong> {aiFeedback}
                    <br />
                    <span className="text-[11px] text-muted-foreground mt-1 block">
                      Adding this detail gives us the best chance of finding the right match.
                      You can go back to edit or post as-is.
                    </span>
                  </AlertDescription>
                </Alert>
              )}

              {(isComplete || !aiFeedback) && (
                <p className="text-sm text-green-700 dark:text-green-400">
                  ✓ Your post looks clear and specific.
                </p>
              )}
            </div>
          )}

          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {step === 'form' && (
              <Button onClick={handleNext} disabled={isReviewing} className="gap-1.5">
                {isReviewing
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Reviewing…</>
                  : <><Sparkles className="h-4 w-4" /> Next — AI review</>
                }
              </Button>
            )}

            {step === 'ai-feedback' && (
              <>
                <Button onClick={handlePost} disabled={isPosting}>
                  {isPosting ? 'Posting…' : 'Post & notify matches'}
                </Button>
                <Button variant="outline" onClick={() => setStep('form')} disabled={isPosting}>
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
