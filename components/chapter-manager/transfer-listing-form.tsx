'use client'

import { useState, useTransition } from 'react'
import { initiateProfileTransfer } from '@/actions/chapter-manager'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle2, Send } from 'lucide-react'

interface Listing {
  id: string
  name: string
  email: string | null
  status: string
}

interface TransferListingFormProps {
  chapterId: number
  listings: Listing[]
}

export function TransferListingForm({ chapterId, listings }: TransferListingFormProps) {
  const [businessId, setBusinessId] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = () => {
    setError(null)
    setSuccess(false)
    if (!businessId) { setError('Select a listing to transfer'); return }
    if (!recipientEmail.trim()) { setError('Enter the recipient\'s email'); return }

    startTransition(async () => {
      const res = await initiateProfileTransfer({
        business_id: businessId,
        chapter_id: chapterId,
        recipient_email: recipientEmail.trim(),
      })
      if (res.error) { setError(res.error); return }
      setSuccess(true)
      setBusinessId('')
      setRecipientEmail('')
    })
  }

  if (listings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No unclaimed listings to transfer. Create member profiles first via CSV import or manually.
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="space-y-1.5">
        <Label>Listing to transfer <span className="text-destructive">*</span></Label>
        <Select value={businessId} onValueChange={(v) => setBusinessId(v ?? '')}>
          <SelectTrigger>
            <SelectValue placeholder="Select a listing…" />
          </SelectTrigger>
          <SelectContent>
            {listings.map(l => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recipient-email">
          Member&apos;s email <span className="text-destructive">*</span>
        </Label>
        <Input
          id="recipient-email"
          type="email"
          value={recipientEmail}
          onChange={e => setRecipientEmail(e.target.value)}
          placeholder="member@example.com"
        />
        <p className="text-[11px] text-muted-foreground">
          A claim link is sent to this address. Once they claim, you can no longer edit this listing.
        </p>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {success && (
        <Alert className="bg-green-500/10 border-green-500/20">
          <AlertDescription className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Claim email sent. The transfer audit log has been recorded.
          </AlertDescription>
        </Alert>
      )}

      <Button onClick={handleSubmit} disabled={isPending} className="gap-2 w-full">
        {isPending ? 'Sending…' : <><Send className="h-4 w-4" /> Send claim link</>}
      </Button>
    </div>
  )
}
