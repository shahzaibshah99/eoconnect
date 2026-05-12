'use client'

import { useState, useTransition } from 'react'
import { submitEndorsement } from '@/actions/marketplace'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Handshake, Loader2 } from 'lucide-react'

interface EndorsementFormProps {
  businessId: string
}

export function EndorsementForm({ businessId }: EndorsementFormProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = () => {
    setError(null)
    setIsSuccess(false)

    startTransition(async () => {
      const res = await submitEndorsement({
        business_id: businessId,
        text: text.trim() || undefined,
      })

      if (res.error) {
        setError(res.error)
        return
      }

      setIsSuccess(true)
      setText('')
      // Reset success message after 3 seconds
      setTimeout(() => setIsSuccess(false), 3000)
    })
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Handshake className="h-4 w-4 text-primary" />
        <label className="text-sm font-medium">Endorse this business</label>
        <Badge variant="outline" className="ml-auto text-[10px]">Optional</Badge>
      </div>

      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Share your experience working with this business… (max 200 characters)"
        rows={3}
        maxLength={200}
        disabled={isPending}
        className="resize-none"
      />
      <p className="text-[11px] text-muted-foreground text-right">{text.length}/200</p>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {isSuccess && (
        <Alert className="bg-green-500/10 border-green-500/20">
          <AlertDescription className="text-green-700 dark:text-green-400">
            ✓ Thank you for endorsing this business!
          </AlertDescription>
        </Alert>
      )}

      <Button onClick={handleSubmit} disabled={isPending} className="w-full gap-2">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Endorsing…
          </>
        ) : (
          <>
            <Handshake className="h-4 w-4" />
            Add Endorsement
          </>
        )}
      </Button>
    </div>
  )
}
