'use client'

import { useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TagInputProps {
  /** Current value as comma-separated string (matches FormData expectations). */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Maximum number of tags. Default 10. */
  maxTags?: number
  /** Maximum chars per tag. Default 30. */
  maxLength?: number
  className?: string
  id?: string
}

/**
 * Chip-style tag input. Replaces the plain text "comma-separated" input
 * with a cleaner UX:
 *   - Pressing Enter or typing a comma converts the typed text into a chip
 *   - Each chip has a × to remove
 *   - Backspace on an empty input removes the last chip
 *   - Pasting "a, b, c" splits into three chips
 *
 * Stores the value as a comma-separated string so the existing form data
 * pipeline (formData.get('tags').split(',')) keeps working unchanged.
 */
export function TagInput({
  value,
  onChange,
  placeholder = 'Type and press Enter…',
  maxTags = 10,
  maxLength = 30,
  className,
  id,
}: TagInputProps) {
  const [input, setInput] = useState('')

  const tags = value
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)

  const setTags = (next: string[]) => {
    // Dedupe (case-insensitive) and trim while preserving order.
    const seen = new Set<string>()
    const cleaned: string[] = []
    for (const t of next) {
      const key = t.toLowerCase()
      if (!seen.has(key) && t) {
        seen.add(key)
        cleaned.push(t.slice(0, maxLength))
      }
    }
    onChange(cleaned.slice(0, maxTags).join(', '))
  }

  const commit = (raw: string) => {
    // Allow paste of "a, b, c" by splitting on commas inside the typed value too.
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean)
    if (parts.length === 0) return
    setTags([...tags, ...parts])
    setInput('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(input)
      return
    }
    if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      e.preventDefault()
      setTags(tags.slice(0, -1))
    }
  }

  const remove = (i: number) => setTags(tags.filter((_, idx) => idx !== i))

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 min-h-10 px-2 py-1.5 rounded-lg border border-input bg-transparent text-sm',
        'focus-within:ring-3 focus-within:ring-ring/50 focus-within:border-ring',
        className
      )}
      onClick={(e) => {
        // Click anywhere in the chip strip → focus the input. Easier on mobile.
        const inp = (e.currentTarget as HTMLDivElement).querySelector('input')
        inp?.focus()
      }}
    >
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-md text-xs font-medium"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={(e) => { e.stopPropagation(); remove(i) }}
            className="hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Input
        id={id}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) commit(input) }}
        placeholder={tags.length === 0 ? placeholder : ''}
        maxLength={maxLength}
        className="flex-1 min-w-[120px] border-0 bg-transparent shadow-none focus-visible:ring-0 px-1 py-0 h-7"
      />
    </div>
  )
}
