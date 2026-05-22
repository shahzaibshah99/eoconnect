'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { createCategory, toggleCategoryActive, updateCategory } from '@/actions/admin'

interface Category {
  id: string
  name: string
  slug: string
  icon: string | null
  sort_order: number
  active: boolean
}

export function CategoriesManager({ categories, bizCountByCategory }: { categories: Category[]; bizCountByCategory: Record<string, number> }) {
  return (
    <div className="space-y-6">
      <NewCategoryForm nextSortOrder={(categories.at(-1)?.sort_order ?? 0) + 1} />
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left p-3 font-medium">Icon</th>
              <th className="text-left p-3 font-medium">Name</th>
              <th className="text-left p-3 font-medium">Slug</th>
              <th className="text-left p-3 font-medium">Order</th>
              <th className="text-left p-3 font-medium">Businesses</th>
              <th className="text-left p-3 font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {categories.map(c => (
              <CategoryRow key={c.id} category={c} bizCount={bizCountByCategory[c.id] ?? 0} />
            ))}
            {categories.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-muted-foreground text-sm">No categories yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NewCategoryForm({ nextSortOrder }: { nextSortOrder: number }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [icon, setIcon] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const fd = new FormData()
    fd.set('name', name)
    fd.set('slug', slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    fd.set('icon', icon)
    fd.set('sort_order', String(nextSortOrder))
    startTransition(async () => {
      const result = await createCategory(fd)
      if (result.error) setError(result.error)
      else { setName(''); setSlug(''); setIcon('') }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-4 space-y-3">
      <h3 className="font-semibold text-sm">Add Category</h3>
      <div className="grid grid-cols-1 sm:grid-cols-[80px_1fr_1fr] gap-2">
        <Input placeholder="🤖" value={icon} onChange={e => setIcon(e.target.value)} maxLength={4} />
        <Input placeholder="Category name" value={name} onChange={e => setName(e.target.value)} required />
        <Input placeholder="Slug (auto if empty)" value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
        {isPending ? 'Adding…' : 'Add Category'}
      </Button>
    </form>
  )
}

function CategoryRow({ category, bizCount }: { category: Category; bizCount: number }) {
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)
  const [icon, setIcon] = useState(category.icon ?? '')
  const [sortOrder, setSortOrder] = useState(String(category.sort_order))

  const save = () => {
    const fd = new FormData()
    fd.set('name', name)
    fd.set('slug', category.slug)
    fd.set('icon', icon)
    fd.set('sort_order', sortOrder)
    startTransition(async () => {
      const result = await updateCategory(category.id, fd)
      if (!result.error) setEditing(false)
    })
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="p-3">
        {editing ? (
          <Input className="h-8 w-16" value={icon} onChange={e => setIcon(e.target.value)} maxLength={4} />
        ) : (
          <span className="text-lg">{category.icon ?? '—'}</span>
        )}
      </td>
      <td className="p-3">
        {editing ? (
          <Input className="h-8" value={name} onChange={e => setName(e.target.value)} />
        ) : (
          <span className="font-medium">{category.name}</span>
        )}
      </td>
      <td className="p-3 text-muted-foreground font-mono text-xs">{category.slug}</td>
      <td className="p-3 w-20">
        {editing ? (
          <Input className="h-8 w-16" type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} />
        ) : (
          category.sort_order
        )}
      </td>
      <td className="p-3 text-muted-foreground text-xs">
        {bizCount > 0
          ? <span className="font-medium text-foreground">{bizCount}</span>
          : <span className="text-muted-foreground/50">0</span>
        }
      </td>
      <td className="p-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={category.active}
            onCheckedChange={(v: boolean) => startTransition(() => { toggleCategoryActive(category.id, v) })}
            disabled={isPending}
          />
          {editing ? (
            <>
              <Button size="sm" onClick={save} disabled={isPending}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          )}
        </div>
      </td>
    </tr>
  )
}
