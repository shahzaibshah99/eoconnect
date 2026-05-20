'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { requestPasswordReset, updatePassword } from '@/actions/auth'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'

/**
 * Reset password flow.
 *
 * Detects "set new password" mode via three signals (any one is enough):
 *   1. ?type=recovery  in the URL query string
 *   2. #...&type=recovery  in the URL hash (Supabase's modern PKCE/recovery
 *      flow puts the recovery token in the hash, not the query)
 *   3. Supabase fires a 'PASSWORD_RECOVERY' auth state event when it picks
 *      up a recovery token from the URL — most reliable, handles async
 *      session bootstrapping.
 *
 * Without (2) and (3), users would land on the email-entry form again
 * after clicking the email link, never seeing the new-password input.
 */
export function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [isSettingNew, setIsSettingNew] = useState<boolean>(() => {
    return searchParams.get('type') === 'recovery'
  })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Detect recovery mode from URL hash or Supabase auth state events.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash.includes('type=recovery')) {
      setIsSettingNew(true)
    }
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsSettingNew(true)
    })
    return () => { subscription.unsubscribe() }
  }, [])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = isSettingNew
        ? await updatePassword(formData)
        : await requestPasswordReset(formData)
      if (result?.error) setError(result.error)
      else if (isSettingNew) router.push('/marketplace')
      else setSuccess(true)
    })
  }

  if (success) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <div className="text-4xl mb-4">📧</div>
          <h2 className="text-xl font-bold mb-2">Check your email</h2>
          <p className="text-muted-foreground text-sm">
            We sent a password reset link to your email address.
          </p>
          <Link href="/login" className="text-primary text-sm font-medium hover:underline block mt-4">
            Back to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-card border border-border rounded-xl p-8">
        <h1 className="text-2xl font-bold mb-2">
          {isSettingNew ? 'Set a new password' : 'Reset password'}
        </h1>
        <p className="text-muted-foreground text-sm mb-6">
          {isSettingNew
            ? 'Choose a new password for your Member Market account.'
            : "Enter your email and we'll send you a reset link."}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {isSettingNew ? (
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input id="password" name="password" type="password" placeholder="Min. 8 characters" required minLength={8} autoComplete="new-password" />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="you@company.com" required autoComplete="email" />
            </div>
          )}
          <Button type="submit" className="w-full bg-primary text-primary-foreground font-bold" disabled={isPending}>
            {isPending ? 'Sending…' : isSettingNew ? 'Update password' : 'Send reset link'}
          </Button>
        </form>
        <Link href="/login" className="text-primary text-sm font-medium hover:underline block text-center mt-4">
          Back to login
        </Link>
      </div>
    </div>
  )
}
