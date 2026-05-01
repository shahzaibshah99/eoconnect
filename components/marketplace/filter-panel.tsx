'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Category } from '@/types/database'

interface FilterPanelProps {
  categories: Category[]
}

// The 11 canonical EO regions. Mirrors the check constraint on
// profiles.region from migration 008. Filter selection uses these
// values verbatim and the search page resolves them by joining
// businesses to their owner's profile (the businesses table has no
// region column — region lives on the member, not the listing).
const REGIONS = [
  'Asia Pacific',
  'Canada',
  'Europe',
  'Japan',
  'Latin America/Caribbean',
  'MEPA',
  'North Asia',
  'South Asia',
  'United States - Central',
  'United States - East',
  'United States - West',
]

export function FilterPanel({ categories }: FilterPanelProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const updateFilter = useCallback((key: string, value: string, checked?: boolean) => {
    const params = new URLSearchParams(searchParams.toString())
    if (key === 'category') {
      const current = params.getAll('category')
      if (checked) {
        params.append('category', value)
      } else {
        const filtered = current.filter(v => v !== value)
        params.delete('category')
        filtered.forEach(v => params.append('category', v))
      }
    } else if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`/marketplace/search?${params.toString()}`)
  }, [router, searchParams])

  const reset = () => {
    const q = searchParams.get('q')
    router.push(q ? `/marketplace/search?q=${q}` : '/marketplace/search')
  }

  const selectedCategories = searchParams.getAll('category')
  const selectedCountry = searchParams.get('country') ?? ''
  const selectedSort = searchParams.get('sort') ?? 'relevance'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm uppercase tracking-wide">Filters</h3>
        <Button variant="ghost" size="sm" onClick={reset} className="text-xs text-muted-foreground h-7">
          Reset
        </Button>
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-3 block">Industry</Label>
        <div className="space-y-2">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center gap-2">
              <Checkbox
                id={cat.slug}
                checked={selectedCategories.includes(cat.slug)}
                onCheckedChange={(checked) => updateFilter('category', cat.slug, !!checked)}
              />
              <label htmlFor={cat.slug} className="text-sm cursor-pointer">{cat.name}</label>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-3 block">Region</Label>
        <Select value={selectedCountry} onValueChange={(v) => updateFilter('country', v ?? '')}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Any region" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Any region</SelectItem>
            {REGIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-3 block">Sort By</Label>
        <Select value={selectedSort} onValueChange={(v) => updateFilter('sort', v ?? '')}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">Relevance</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="alpha">A–Z</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
