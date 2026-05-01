'use client'

import { useState, useTransition } from 'react'
import { completeOnboarding } from '@/actions/onboarding'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Sparkles } from 'lucide-react'
import { ChapterPicker, type Chapter } from '@/components/forms/chapter-picker'

const MEMBERSHIP_LABEL: Record<string, string> = {
  current_member: 'Current EO Member',
  alumni: 'EO Alumni',
  accelerator: 'EO Accelerator',
}

interface Props {
  chapters: Chapter[]
  defaultName: string
  defaultChapter: string
  defaultMembershipType: string
}

export function OnboardingForm({ chapters, defaultName, defaultChapter, defaultMembershipType }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [membershipType, setMembershipType] = useState(defaultMembershipType)
  const [chapter, setChapter] = useState<Chapter | null>(
    chapters.find(c => c.name === defaultChapter) ?? null
  )

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    if (!chapter) {
      setError('Please select your EO chapter')
      return
    }
    const fd = new FormData(e.currentTarget)
    fd.set('eo_membership_type', membershipType)
    fd.set('eo_chapter', chapter.name)
    fd.set('region', chapter.region)
    fd.set('chapter_country', chapter.country ?? '')
    fd.set('chapter_city', chapter.city ?? '')
    startTransition(async () => {
      const result = await completeOnboarding(fd)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="w-full max-w-lg">
      <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Welcome — let&apos;s set you up</h1>
            <p className="text-sm text-muted-foreground">A few details so members know who you are.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="full_name">Full Name *</Label>
            <Input id="full_name" name="full_name" defaultValue={defaultName} required minLength={2} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="eo_membership_type">EO Membership Type *</Label>
            <Select value={membershipType} onValueChange={(v: string | null) => setMembershipType(v ?? '')}>
              <SelectTrigger id="eo_membership_type" className="w-full h-10">
                <SelectValue placeholder="Select your status">
                  {(v: string | null) => MEMBERSHIP_LABEL[v ?? ''] ?? 'Select your status'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current_member">Current EO Member</SelectItem>
                <SelectItem value="alumni">EO Alumni</SelectItem>
                <SelectItem value="accelerator">EO Accelerator</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>EO Chapter *</Label>
            <ChapterPicker chapters={chapters} value={chapter?.name ?? null} onChange={setChapter} />
            {chapter && (chapter.country || chapter.city) && (
              <p className="text-xs text-muted-foreground">
                Region: <span className="text-foreground">{chapter.region}</span>
                {chapter.country && <> · Country: <span className="text-foreground">{chapter.country}</span></>}
                {chapter.city && <> · City: <span className="text-foreground">{chapter.city}</span></>}
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={isPending || !membershipType || !chapter}
            className="w-full bg-primary text-primary-foreground font-bold mt-2"
          >
            {isPending ? 'Saving…' : 'Continue → list your business'}
          </Button>

          <p className="text-xs text-muted-foreground text-center pt-2">
            Next, you&apos;ll add a business listing so other members can find you.
          </p>
        </form>
      </div>
    </div>
  )
}
