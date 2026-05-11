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

// F09: Verification tag options shown in the Member Type filter.
// Labels are human-friendly; values match businesses.verification_tag.
const MEMBER_TYPE_OPTIONS = [
  { value: 'eo_member',      label: 'EO Member' },
  { value: 'eo_accelerator', label: 'EO Accelerator' },
  { value: 'eo_alumni',      label: 'EO Alumni' },
  { value: 'eo_sponsor',     label: 'EO Sponsor' },
  { value: 'ypo_member',     label: 'YPO Member' },
  { value: 'ypo_alumni',     label: 'YPO Alumni' },
  { value: 'ypo_sponsor',    label: 'YPO Sponsor' },
] as const

// F09: Team size options matching the TeamSize enum in types/database.ts
const TEAM_SIZE_OPTIONS = [
  { value: '1-10',    label: '1–10 people' },
  { value: '11-50',   label: '11–50 people' },
  { value: '51-200',  label: '51–200 people' },
  { value: '201-500', label: '201–500 people' },
  { value: '500+',    label: '500+ people' },
] as const

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
  // F09 new filters
  const selectedTag = searchParams.get('tag') ?? ''
  const selectedTeamSize = searchParams.get('team_size') ?? ''
  const selectedItemType = searchParams.get('item_type') ?? ''

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

      {/* F09: Member type (verification_tag) */}
      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-3 block">Member type</Label>
        <Select value={selectedTag} onValueChange={(v) => updateFilter('tag', v ?? '')}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Any member type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Any member type</SelectItem>
            {MEMBER_TYPE_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* F09: Team size */}
      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-3 block">Team size</Label>
        <Select value={selectedTeamSize} onValueChange={(v) => updateFilter('team_size', v ?? '')}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Any size" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Any size</SelectItem>
            {TEAM_SIZE_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* F09: Service or Product */}
      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-3 block">Listing type</Label>
        <div className="flex gap-1">
          {([
            { value: '', label: 'All' },
            { value: 'service', label: 'Services' },
            { value: 'product', label: 'Products' },
          ] as const).map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => updateFilter('item_type', o.value)}
              className={`flex-1 h-8 rounded-md border text-xs font-medium transition-colors ${
                selectedItemType === o.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:bg-muted'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
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
