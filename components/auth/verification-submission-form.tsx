'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { submitVerification } from '@/actions/verification'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, X, ImageIcon } from 'lucide-react'

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB — screenshots shouldn't be huge
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

interface Props {
  tenantId: string
}

/**
 * Two-step submission: client-side image upload to the existing
 * 'eoconnect-media' bucket (matches the business profile wizard
 * pattern), then a server action that records the verification row.
 *
 * Why client-side upload: server actions in Next have a default body
 * size limit and shipping the screenshot through the action would force
 * us to either bump the limit or stream — using direct browser → Supabase
 * upload sidesteps both. The action only sees the resulting URL.
 */
export function VerificationSubmissionForm({ tenantId }: Props) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [linkedin, setLinkedin] = useState('')
  const [progress, setProgress] = useState<'idle' | 'uploading' | 'recording'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const pickFile = (f: File | null) => {
    setError(null)
    if (!f) {
      setFile(null)
      setPreview(null)
      return
    }
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError('Please upload a PNG, JPEG, or WebP image')
      return
    }
    if (f.size > MAX_BYTES) {
      setError('File is too large — keep it under 5 MB')
      return
    }
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!file) {
      setError('Please select a screenshot to upload')
      return
    }

    setProgress('uploading')
    let screenshotUrl: string
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Session expired — please log in again')

      const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]/g, '_').slice(0, 80) || 'screenshot'
      const path = `verifications/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
      const { error: upErr } = await supabase.storage.from('eoconnect-media').upload(path, file)
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`)
      screenshotUrl = supabase.storage.from('eoconnect-media').getPublicUrl(path).data.publicUrl
    } catch (err) {
      setProgress('idle')
      setError(err instanceof Error ? err.message : 'Upload failed')
      return
    }

    setProgress('recording')
    startTransition(async () => {
      const fd = new FormData()
      fd.set('screenshot_url', screenshotUrl)
      if (linkedin.trim()) fd.set('linkedin_url', linkedin.trim())

      const res = await submitVerification(fd)
      if (res.error) {
        setProgress('idle')
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  const busy = progress !== 'idle' || isPending
  const buttonLabel =
    progress === 'uploading' ? 'Uploading screenshot…' :
    progress === 'recording' ? 'Submitting…' :
    'Submit for review'

  return (
    <form onSubmit={submit} className="bg-card border border-border rounded-xl p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Submit your verification</h2>
        <p className="text-xs text-muted-foreground">
          Tenant: <span className="uppercase tracking-wide font-medium">{tenantId}</span>
        </p>
      </div>

      {/* Screenshot picker */}
      <div className="space-y-2">
        <Label>Screenshot of member profile <span className="text-destructive">*</span></Label>
        {preview ? (
          <div className="relative inline-block">
            <Image
              src={preview}
              alt="Screenshot preview"
              width={320}
              height={240}
              unoptimized
              className="max-w-xs rounded-lg border border-border h-auto w-auto"
            />
            <button
              type="button"
              onClick={() => { pickFile(null); if (fileRef.current) fileRef.current.value = '' }}
              disabled={busy}
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow disabled:opacity-50"
              aria-label="Remove screenshot"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full border-2 border-dashed border-border rounded-lg p-8 hover:border-primary hover:bg-muted/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Upload className="h-6 w-6" />
              <p className="text-sm font-medium">Click to upload a screenshot</p>
              <p className="text-xs">PNG, JPEG, or WebP up to 5 MB</p>
            </div>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          className="hidden"
          onChange={e => pickFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <ImageIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Take a screenshot of your EO/YPO member profile page that shows your name and chapter. Crop anything sensitive — admin just needs the membership signal.</span>
        </p>
      </div>

      {/* LinkedIn URL */}
      <div className="space-y-2">
        <Label htmlFor="linkedin_url">LinkedIn profile URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input
          id="linkedin_url"
          type="url"
          inputMode="url"
          placeholder="https://www.linkedin.com/in/your-handle"
          value={linkedin}
          onChange={e => setLinkedin(e.target.value)}
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">
          Used as a supporting signal during admin review. Never auto-approves.
        </p>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={busy || !file}>
          {buttonLabel}
        </Button>
      </div>
    </form>
  )
}
