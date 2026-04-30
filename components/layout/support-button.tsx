'use client'

import { useState, useTransition } from 'react'
import { LifeBuoy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { submitSupportInquiry } from '@/actions/support'

interface SupportButtonProps {
  /** Member's display name. Used to personalise the dialog copy. Optional. */
  memberName?: string | null
}

/**
 * In-app support entry point.
 *
 * Renders a help (life-buoy) icon button that opens a modal with a
 * subject + message form. Submission goes through the
 * submitSupportInquiry server action, which looks up the signed-in
 * member's profile (id / name / email / chapter) server-side and
 * sends an email to support@member.market. The member's email becomes
 * the Reply-To so the support team can reply directly.
 *
 * Why a server-rendered identity rather than passing it from the
 * client: a malicious client could otherwise impersonate any other
 * member in the inquiry header. The form here only collects what the
 * member is actually writing.
 *
 * Sits in the navbar — always reachable, no matter what page the
 * member is on.
 */
export function SupportButton({ memberName }: SupportButtonProps) {
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const reset = () => {
    setSubject('')
    setBody('')
    setError(null)
    setSuccess(false)
  }

  const handleOpenChange = (next: boolean) => {
    // Lock the dialog while a submit is in flight — closing mid-flight
    // could lose the success/error state.
    if (isPending) return
    setOpen(next)
    if (!next) reset()
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isPending) return
    setError(null)
    setSuccess(false)
    const fd = new FormData()
    fd.set('subject', subject)
    fd.set('body', body)
    startTransition(async () => {
      const result = await submitSupportInquiry(fd)
      if (result.error) {
        setError(result.error)
        return
      }
      setSuccess(true)
      // Auto-close after a beat so the user sees the confirmation.
      setTimeout(() => handleOpenChange(false), 1500)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label="Contact support"
            title="Contact support"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LifeBuoy className="h-[18px] w-[18px]" />
          </button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Contact support</DialogTitle>
          <DialogDescription>
            {memberName
              ? `We'll reply to your member email, ${memberName.split(' ')[0]}.`
              : "We'll reply to your member email."}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <Alert className="border-green-500/40 bg-green-500/10">
            <AlertDescription className="text-green-900 dark:text-green-200">
              Thanks — your message is on its way to the support team.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="support-subject">Subject</Label>
              <Input
                id="support-subject"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Briefly, what's this about?"
                required
                maxLength={120}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="support-body">Message</Label>
              <Textarea
                id="support-body"
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Share as much detail as you can — steps you tried, what you expected, what you got."
                required
                rows={6}
                maxLength={5000}
                disabled={isPending}
              />
              <p className="text-[11px] text-muted-foreground">{body.length} / 5000 characters</p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !subject.trim() || body.trim().length < 10}>
                {isPending ? 'Sending…' : 'Send'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
