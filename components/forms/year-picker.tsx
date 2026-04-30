'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Calendar, Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface YearPickerProps {
  value: string
  onChange: (year: string) => void
  /** Earliest year selectable. Default 1900. */
  min?: number
  /** Latest year selectable. Default current year. */
  max?: number
  placeholder?: string
  required?: boolean
}

/**
 * Year picker — opens a dialog with a scrollable list of years from
 * `max` (default: current year) down to `min` (default: 1900). User
 * can either click directly or type into the search box to filter.
 *
 * Replaces the old `<input type="number">` which had two UX issues:
 *  1. On mobile, the numeric keyboard popped up but felt awkward for a
 *     4-digit field.
 *  2. Easy to typo (1029 instead of 2019, etc.) with no validation
 *     feedback until form submit.
 */
export function YearPicker({
  value,
  onChange,
  min = 1900,
  max = new Date().getFullYear(),
  placeholder = 'Select year',
  required,
}: YearPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Years from newest to oldest — most companies pick a recent year, so
  // putting the latest at the top means less scrolling.
  const years = useMemo(() => {
    const out: number[] = []
    for (let y = max; y >= min; y--) out.push(y)
    return out
  }, [min, max])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return years
    return years.filter(y => String(y).includes(q))
  }, [years, query])

  // Auto-scroll to the selected year when the dialog opens so the user
  // sees their current pick in context.
  useEffect(() => {
    if (!open) return
    setQuery('')
    if (!value) return
    const idx = years.indexOf(Number(value))
    if (idx < 0) return
    requestAnimationFrame(() => {
      const button = listRef.current?.querySelector(`[data-year="${value}"]`) as HTMLElement | null
      button?.scrollIntoView({ block: 'center' })
    })
  }, [open, value, years])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" className="w-full justify-start font-normal h-10" />
        }
      >
        <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
        <span className={cn('truncate', !value && 'text-muted-foreground')}>
          {value || placeholder}
        </span>
        {required && !value && <span className="sr-only">required</span>}
      </DialogTrigger>
      <DialogContent className="max-w-xs p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="text-base">Founded year</DialogTitle>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Type a year…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="pl-9 h-10"
              inputMode="numeric"
            />
          </div>
        </DialogHeader>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No matching years
            </div>
          ) : (
            filtered.map(y => {
              const yStr = String(y)
              const isSelected = yStr === value
              return (
                <button
                  key={y}
                  type="button"
                  data-year={yStr}
                  onClick={() => { onChange(yStr); setOpen(false) }}
                  className={cn(
                    'w-full text-left px-5 py-2.5 hover:bg-muted transition-colors flex items-center gap-2 text-sm',
                    isSelected && 'bg-primary/10 font-medium'
                  )}
                >
                  {isSelected ? (
                    <Check className="h-4 w-4 text-primary flex-shrink-0" />
                  ) : (
                    <span className="h-4 w-4 flex-shrink-0" />
                  )}
                  {y}
                </button>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
