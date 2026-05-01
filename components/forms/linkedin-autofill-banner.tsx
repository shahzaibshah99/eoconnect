'use client'

import { useState, useTransition } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { autofillFromLinkedIn, type LinkedInAutofill } from '@/actions/linkedin-autofill'

interface LinkedInAutofillBannerProps {
  /** Called once with the prefilled payload after a successful fetch.
   *  Caller is responsible for merging it into the wizard's formData. */
  onAutofill: (data: LinkedInAutofill) => void
  /** True when a previous auto-fill has already populated the form
   *  this session — we render a "Re-fetch" instead of "Auto-fill"
   *  so the user knows what they're about to overwrite. */
  hasFilledOnce: boolean
}

/**
 * Step 0 of the new-business wizard renders this banner above the
 * manual form. Click "Auto-fill from LinkedIn" → modal opens →
 * paste the company URL → wait ~3-5s while the server fetches the
 * LinkedIn payload, downloads the logo + cover into our storage,
 * and maps industries to category slugs → form fields populate
 * automatically and the user proceeds through the wizard normally
 * to review and edit.
 *
 * Failures (no API key, bad URL, no such company, downstream error)
 * surface inline in the modal — caller never sees an exception.
 */
export function LinkedInAutofillBanner({ onAutofill, hasFilledOnce }: LinkedInAutofillBannerProps) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    if (!url.trim()) {
      setError('Paste your LinkedIn company URL.')
      return
    }
    startTransition(async () => {
      const result = await autofillFromLinkedIn(url.trim())
      if (result.error || !result.data) {
        setError(result.error ?? 'Auto-fill failed. Try again or fill manually.')
        return
      }
      onAutofill(result.data)
      setOpen(false)
      setUrl('')
    })
  }

  return (
    <>
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-6 flex items-start gap-3">
        <div className="rounded-lg bg-primary/15 p-2 flex-shrink-0">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">
            {hasFilledOnce ? 'Auto-fill imported' : 'Save time — auto-fill from LinkedIn'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasFilledOnce
              ? "Review the details below and edit anything that's off. You can re-fetch from a different URL if needed."
              : 'Paste your company\'s LinkedIn URL and we\'ll pre-fill the basics. You\'ll review everything before publishing.'}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            className="mt-2.5 gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {hasFilledOnce ? 'Re-fetch from LinkedIn' : 'Auto-fill from LinkedIn'}
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!isPending) { setOpen(v); if (!v) setError(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Auto-fill from LinkedIn</DialogTitle>
            <DialogDescription>
              Paste your company's LinkedIn page URL. We'll pull the name, description, location, logo,
              cover image, team size, and tags. You'll review everything before publishing.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="linkedin-url">LinkedIn URL</Label>
              <Input
                id="linkedin-url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://www.linkedin.com/company/your-company"
                autoFocus
                disabled={isPending}
              />
              <p className="text-[11px] text-muted-foreground">
                Both <code>linkedin.com/company/your-company</code> and the bare username work.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {isPending && (
              <Alert>
                <AlertDescription className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Fetching from LinkedIn and copying the logo + cover into your account…
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !url.trim()}>
                {isPending ? 'Fetching…' : 'Auto-fill'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
