'use client'

import { useRef, useState, useCallback } from 'react'
import { searchMembersForMention, type MentionResult } from '@/actions/bulletin'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MentionTextareaProps {
  value: string
  onChange: (val: string) => void
  disabled?: boolean
  placeholder?: string
  rows?: number
  maxLength?: number
  className?: string
}

export function MentionTextarea({
  value, onChange, disabled, placeholder, rows = 3, maxLength, className,
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [results, setResults] = useState<MentionResult[]>([])
  const [mentionStart, setMentionStart] = useState(-1)
  const [activeIndex, setActiveIndex] = useState(0)
  const [open, setOpen] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    onChange(text)

    const cursor = e.target.selectionStart ?? text.length
    const before = text.slice(0, cursor)
    // Match the @ trigger: @ followed by word chars and dots (the mention being typed)
    const match = before.match(/@([\w.]*)$/)

    if (match) {
      const q = match[1].replace(/\./g, ' ').trim()
      setMentionStart(cursor - match[0].length)
      setActiveIndex(0)

      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (q.length >= 1) {
        debounceRef.current = setTimeout(async () => {
          const res = await searchMembersForMention(q)
          setResults(res)
          setOpen(res.length > 0)
        }, 200)
      } else {
        // Show top members immediately on bare @
        debounceRef.current = setTimeout(async () => {
          const res = await searchMembersForMention('')
          setResults(res)
          setOpen(res.length > 0)
        }, 100)
      }
    } else {
      setOpen(false)
      setResults([])
    }
  }

  const insertMention = useCallback((result: MentionResult) => {
    if (mentionStart === -1 || !ref.current) return
    const cursor = ref.current.selectionStart ?? value.length
    const before = value.slice(0, mentionStart)
    const after = value.slice(cursor)
    const newValue = `${before}@${result.handle} ${after}`
    onChange(newValue)
    setOpen(false)
    setResults([])
    // Restore cursor after the inserted mention
    setTimeout(() => {
      if (!ref.current) return
      const pos = mentionStart + result.handle.length + 2 // @ + handle + space
      ref.current.setSelectionRange(pos, pos)
      ref.current.focus()
    }, 0)
  }, [mentionStart, value, onChange])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); insertMention(results[activeIndex]) }
    if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        className={cn(
          'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 w-full bg-popover border border-border rounded-xl shadow-lg overflow-hidden">
          {results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); insertMention(r) }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left',
                i === activeIndex ? 'bg-muted' : 'hover:bg-muted/60'
              )}
            >
              {r.type === 'member' ? (
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarImage src={r.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-bold">
                    {r.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <div className="h-6 w-6 shrink-0 rounded-full bg-muted flex items-center justify-center">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{r.name}</p>
                {r.subtitle && <p className="text-[11px] text-muted-foreground truncate">{r.subtitle}</p>}
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 capitalize">{r.type}</span>
            </button>
          ))}
          <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border">
            ↑↓ navigate · Enter select · Esc close
          </p>
        </div>
      )}
    </div>
  )
}

// Renders reply content with @Handle.Name highlighted in blue
export function renderMentions(content: string): React.ReactNode {
  const parts = content.split(/([@][\w.]+)/g)
  return parts.map((part, i) =>
    /^@[\w.]+$/.test(part)
      ? <span key={i} className="text-primary font-medium">
          {part}
        </span>
      : <span key={i}>{part}</span>
  )
}
