'use client'

import { useState, useTransition } from 'react'
import { signUp } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { GoogleButton } from './google-button'
import Link from 'next/link'

/**
 * Signup form: collects only the bare minimum needed to create an auth
 * user — full name, email, password.
 *
 * EO Membership Type and EO Chapter are deliberately NOT collected here.
 * Two reasons:
 *
 *  1. With email confirmation enabled, supabase.auth.signUp() doesn't
 *     create a session, so the post-signup profile UPDATE silently
 *     dropped the membership_type field.
 *
 *  2. The chapter field on this form was free text. The rest of the app
 *     (proxy gate, marketplace filters, admin scope) needs the structured
 *     chapter values (region, chapter_country, chapter_city). The
 *     onboarding screen has the proper ChapterPicker for that, so we
 *     route every new user through it after confirmation.
 *
 * This means signup → email confirm → /onboarding (collect chapter +
 * membership type with the structured picker) → /dashboard/business/new.
 */
export function SignupForm() {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await signUp(formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
        <h1 className="text-2xl font-bold mb-2">Join Member Market</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Exclusive to verified members
        </p>

        <GoogleButton label="Sign up with Google" />

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input id="fullName" name="fullName" placeholder="Alex Thompson" required autoComplete="name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Membership Email</Label>
            <Input id="email" name="email" type="email" placeholder="you@company.com" required autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" placeholder="Min. 8 characters" required minLength={8} autoComplete="new-password" />
          </div>
          <Button type="submit" className="w-full bg-primary text-primary-foreground font-bold" disabled={isPending}>
            {isPending ? 'Creating account…' : 'Create Account'}
          </Button>
          <p className="text-xs text-muted-foreground text-center pt-1">
            We&apos;ll ask about your EO chapter and membership type after you confirm your email.
          </p>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-4">
          By registering you confirm you are an active member.
        </p>
        <p className="text-center text-sm text-muted-foreground mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
