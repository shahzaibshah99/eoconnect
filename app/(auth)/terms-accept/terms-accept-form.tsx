'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { acceptTerms } from '@/actions/terms'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'

export function TermsAcceptForm() {
  const router = useRouter()
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const submit = () => {
    if (!checked) return
    setError(null)
    startTransition(async () => {
      const res = await acceptTerms()
      if (res.error) { setError(res.error); return }
      router.replace('/dashboard')
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Checkbox
          id="accept"
          checked={checked}
          onCheckedChange={(v) => setChecked(!!v)}
          className="mt-0.5"
        />
        <label htmlFor="accept" className="text-sm cursor-pointer leading-relaxed">
          I have read and agree to the Member Market terms of use, including the
          non-solicitation policy. I understand that violations may result in
          suspension or removal from the platform.
        </label>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <Button
        onClick={submit}
        disabled={!checked || isPending}
        className="w-full bg-primary text-primary-foreground font-bold"
      >
        {isPending ? 'Saving…' : 'I agree — continue'}
      </Button>

      <p className="text-[11px] text-center text-muted-foreground">
        You cannot use Member Market without accepting these terms.
      </p>
    </div>
  )
}
