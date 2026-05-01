'use client'

import { forwardRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { Category } from '@/types/database'

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
] as const

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'alpha', label: 'A–Z' },
]

interface MobileFilterBarProps {
  categories: Category[]
}

/**
 * Mobile-only filter strip that sits below the search bar.
 *
 * Desktop has a permanent sidebar (FilterPanel). Mobile previously
 * had no way to filter at all — the sidebar is hidden behind
 * `hidden lg:block`. This restores filter access on small screens
 * without the cramped sidebar UX.
 *
 * Three pill-style dropdowns: Category (multi-select), Region
 * (single), Sort (single). Each pill shows the active value count
 * when filters are applied, and an X to clear when active. URL
 * params are written immediately on change so the search results
 * re-render via the existing server component pipeline.
 *
 * Keep this component in sync with FilterPanel — both render the
 * same options and use the same URL params (?category= multi,
 * ?country= for region, ?sort=).
 */
export function MobileFilterBar({ categories }: MobileFilterBarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const selectedCategories = searchParams.getAll('category')
  const selectedRegion = searchParams.get('country') ?? ''
  const selectedSort = searchParams.get('sort') ?? 'relevance'

  const writeParam = useCallback((mut: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString())
    mut(next)
    router.push(`/marketplace/search?${next.toString()}`)
  }, [router, searchParams])

  const toggleCategory = (slug: string) => {
    writeParam(p => {
      const current = p.getAll('category')
      p.delete('category')
      if (current.includes(slug)) {
        current.filter(v => v !== slug).forEach(v => p.append('category', v))
      } else {
        [...current, slug].forEach(v => p.append('category', v))
      }
    })
  }

  const setRegion = (region: string) => {
    writeParam(p => { region ? p.set('country', region) : p.delete('country') })
  }

  const setSort = (sort: string) => {
    writeParam(p => {
      if (sort && sort !== 'relevance') p.set('sort', sort)
      else p.delete('sort')
    })
  }

  const categoryLabel = selectedCategories.length === 0
    ? 'Category'
    : `Category (${selectedCategories.length})`

  const regionLabel = selectedRegion || 'Region'
  const sortLabel = SORT_OPTIONS.find(o => o.value === selectedSort)?.label ?? 'Sort'

  const anyActive = selectedCategories.length > 0 || !!selectedRegion || selectedSort !== 'relevance'

  // Horizontal scroll on mobile when pills overflow. Hidden on desktop
  // because the sidebar FilterPanel covers the same ground.
  return (
    <div className="lg:hidden -mx-3 px-3 sm:mx-0 sm:px-0 overflow-x-auto">
      <div className="flex items-center gap-2 pb-1 w-max sm:w-auto">
        {/* CATEGORY — multi-select. Items use onSelect preventDefault
            so the dropdown stays open while the user toggles
            multiple categories. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <PillButton active={selectedCategories.length > 0}>
                {categoryLabel}
              </PillButton>
            }
          />
          <DropdownMenuContent align="start" className="w-64 max-h-72 overflow-y-auto">
            {categories.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">No categories.</p>
            )}
            {categories.map(cat => {
              const checked = selectedCategories.includes(cat.slug)
              return (
                // base-ui Menu.Item fires `onClick` on selection and
                // closes the menu by default. For the multi-select
                // category list we want the menu to stay open while
                // the user toggles several boxes, so closeOnClick is
                // false. The earlier code attached handlers to
                // `onSelect` (a React text-selection synthetic event
                // — totally inert on menu items) which is why the
                // user reported "filters open but nothing happens."
                <DropdownMenuItem
                  key={cat.id}
                  closeOnClick={false}
                  onClick={() => toggleCategory(cat.slug)}
                >
                  <Checkbox checked={checked} className="mr-2 pointer-events-none" />
                  <span>{cat.icon} {cat.name}</span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* REGION — single-select. Default closeOnClick (true) is fine. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <PillButton active={!!selectedRegion}>
                {regionLabel}
              </PillButton>
            }
          />
          <DropdownMenuContent align="start" className="w-64 max-h-72 overflow-y-auto">
            <DropdownMenuItem onClick={() => setRegion('')}>
              <span className={cn(!selectedRegion && 'font-medium')}>Any region</span>
            </DropdownMenuItem>
            {REGIONS.map(r => (
              <DropdownMenuItem key={r} onClick={() => setRegion(r)}>
                <span className={cn(selectedRegion === r && 'font-medium text-primary')}>{r}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* SORT — single-select with a fixed list. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <PillButton active={selectedSort !== 'relevance'}>
                Sort: {sortLabel}
              </PillButton>
            }
          />
          <DropdownMenuContent align="start" className="w-44">
            {SORT_OPTIONS.map(o => (
              <DropdownMenuItem key={o.value} onClick={() => setSort(o.value)}>
                <span className={cn(selectedSort === o.value && 'font-medium text-primary')}>{o.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Reset — only shown when something's active so it doesn't
            consume horizontal space when there's nothing to reset. */}
        {anyActive && (
          <button
            type="button"
            onClick={() => {
              const q = searchParams.get('q')
              router.push(q ? `/marketplace/search?q=${q}` : '/marketplace/search')
            }}
            className="inline-flex items-center gap-1 px-3 h-8 rounded-full text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
          >
            <X className="h-3 w-3" /> Reset
          </button>
        )}
      </div>
    </div>
  )
}

interface PillButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean
}

/**
 * Pill-shaped button for the filter bar.
 *
 * forwardRef + spread of incoming props is REQUIRED for base-ui's
 * <DropdownMenuTrigger render={<PillButton ...>}> pattern to work.
 * base-ui uses cloneElement under the hood and injects onClick,
 * onPointerDown, aria-expanded, the trigger ref, and several data-*
 * attributes onto the rendered element. Without forwardRef + spread
 * those props land on the OUTER PillButton component (which ignores
 * them) instead of the actual <button>, so the pill renders but
 * doesn't open the dropdown — exactly the "pills not clickable"
 * behaviour the user reported.
 */
const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  function PillButton({ active, children, className, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        {...props}
        className={cn(
          'inline-flex items-center gap-1 px-3 h-8 rounded-full border text-xs font-medium transition-colors flex-shrink-0',
          active
            ? 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/15'
            : 'bg-background border-border text-foreground hover:bg-muted',
          className
        )}
      >
        <span>{children}</span>
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
    )
  }
)
