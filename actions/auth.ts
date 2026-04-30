'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { sendEmail, welcomeEmail } from '@/lib/email/send'

const SignUpSchema = z.object({
  fullName: z.string().min(2, 'Full name required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const SignInSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
})

export type AuthResult = { error: string | null }

export async function signUp(formData: FormData): Promise<AuthResult> {
  const parsed = SignUpSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Only full_name goes into raw_user_meta_data — handle_new_user
      // trigger picks it up and creates the profile row. EO membership
      // type and chapter are NOT collected at signup; they're collected
      // in the structured /onboarding form after email confirmation
      // (see SignupForm comment for the full reasoning).
      data: {
        full_name: parsed.data.fullName,
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  })

  if (error) return { error: error.message }

  // Detect "email already registered" without leaking via a separate
  // check call. Supabase's anti-enumeration default is to return success
  // with no error when the email already exists — but signals it via the
  // returned user's `identities` array being empty. New signups always
  // come back with at least one identity (the email/password one).
  //
  // We surface a real error instead of silently bouncing the user to
  // /verify, where they'd never get a confirmation email and assume the
  // app is broken.
  const identities = data?.user?.identities
  if (data?.user && (!identities || identities.length === 0)) {
    return { error: 'An account with this email already exists. Please sign in instead.' }
  }

  // Welcome email — fire-and-forget so the action returns fast. Supabase
  // sends the verification email separately through its own SMTP config.
  void sendEmail({
    to: parsed.data.email,
    subject: 'Welcome to Member Market',
    html: welcomeEmail(parsed.data.fullName, process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  })

  redirect('/verify')
}

export async function signIn(formData: FormData): Promise<AuthResult> {
  const parsed = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) return { error: error.message }
  redirect('/marketplace')
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

const ResetEmailSchema = z.object({
  email: z.string().email('Invalid email'),
})

const UpdatePasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function requestPasswordReset(formData: FormData): Promise<AuthResult> {
  const parsed = ResetEmailSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!siteUrl) {
    // Without a site URL the email link would be `undefined/reset-password`
    // — Supabase silently sends the email but the link is broken on click.
    // Bail loudly so the user sees a real error instead of "check your email"
    // followed by nothing useful.
    console.error('[auth] NEXT_PUBLIC_SITE_URL is not set — password reset email link would be invalid')
    return { error: 'Password reset is not configured on this deployment. Please contact support.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl.replace(/\/$/, '')}/reset-password?type=recovery`,
  })

  if (error) {
    console.error('[auth] resetPasswordForEmail failed:', error)
    return { error: error.message }
  }
  return { error: null }
}

export async function updatePassword(formData: FormData): Promise<AuthResult> {
  const parsed = UpdatePasswordSchema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) return { error: error.message }
  redirect('/marketplace')
}
