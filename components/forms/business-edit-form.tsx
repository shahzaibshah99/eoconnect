'use client'

import { useState, useTransition, useRef } from 'react'
import { updateBusiness, type BusinessActionResult } from '@/actions/business'
import { DeleteBusinessButton } from '@/components/forms/delete-business-button'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, X, FileText, ImageIcon } from 'lucide-react'
import type { Business, Category } from '@/types/database'
import { LocationPicker } from '@/components/forms/location-picker'
import {
  PORTFOLIO_MAX_FILES,
  PORTFOLIO_MAX_TOTAL_BYTES,
  formatBytes,
  validatePortfolioAddition,
} from '@/lib/portfolio-limits'

const TEAM_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+'] as const

interface BusinessEditFormProps {
  business: Business & { country_code?: string | null }
  categories: Category[]
}

export function BusinessEditForm({ business, categories }: BusinessEditFormProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(business.logo_url ?? null)
  const [coverPreview, setCoverPreview] = useState<string | null>(business.cover_url ?? null)
  const [portfolioFiles, setPortfolioFiles] = useState<File[]>([])
  const [portfolioExisting, setPortfolioExisting] = useState<string[]>((business as { portfolio_urls?: string[] }).portfolio_urls ?? [])
  const logoInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const portfolioInputRef = useRef<HTMLInputElement>(null)

  const socialLinks = (business.social_links ?? {}) as Record<string, string>

  const [formData, setFormData] = useState({
    name: business.name ?? '',
    tagline: business.tagline ?? '',
    description: business.description ?? '',
    website: business.website ?? '',
    founded_year: business.founded_year?.toString() ?? '',
    team_size: business.team_size ?? '' as string,
    city: business.city ?? '',
    country: business.country ?? '',
    country_code: business.country_code ?? '',
    phone: business.phone ?? '',
    email: business.email ?? '',
    tags: business.tags?.join(', ') ?? '',
    social_linkedin: socialLinks.linkedin ?? '',
    social_twitter: socialLinks.twitter ?? '',
    social_instagram: socialLinks.instagram ?? '',
    social_facebook: socialLinks.facebook ?? '',
    category_ids: business.category_ids ?? [] as string[],
  })

  const update = (key: string, value: string) =>
    setFormData(prev => ({ ...prev, [key]: value }))

  const toggleCategory = (id: string) => {
    setFormData(prev => ({
      ...prev,
      category_ids: prev.category_ids.includes(id)
        ? prev.category_ids.filter(c => c !== id)
        : prev.category_ids.length < 3 ? [...prev.category_ids, id] : prev.category_ids,
    }))
  }

  const handlePortfolioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const slotsLeft = PORTFOLIO_MAX_FILES - portfolioFiles.length - portfolioExisting.length
    const files = Array.from(e.target.files ?? []).slice(0, slotsLeft)
    if (!files.length) return
    // Existing portfolio files (already on server) — count as 0 bytes against the
    // budget since we can't easily fetch their sizes here. The server enforces
    // the real total against actual stored bytes.
    const violation = validatePortfolioAddition(portfolioFiles, files)
    if (violation) {
      setError(violation)
      e.target.value = ''
      return
    }
    setError(null)
    setPortfolioFiles(prev => [...prev, ...files].slice(0, PORTFOLIO_MAX_FILES - portfolioExisting.length))
    e.target.value = ''
  }

  const removeExistingPortfolio = (index: number) => {
    setPortfolioExisting(prev => prev.filter((_, i) => i !== index))
  }

  const removeNewPortfolio = (index: number) => {
    setPortfolioFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    const formEl = e.currentTarget

    startTransition(async () => {
      // All files (logo / cover / portfolio) upload directly to Supabase
      // Storage so the form body fits Vercel's ~4.5MB function cap.
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Please sign in again to upload files'); return }

      const uploadFile = async (file: File, folder: string): Promise<string> => {
        const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]/g, '_').slice(0, 80) || 'file'
        const path = `${folder}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
        const { error: uploadErr } = await supabase.storage.from('eoconnect-media').upload(path, file)
        if (uploadErr) throw new Error(`Failed to upload ${file.name}: ${uploadErr.message}`)
        return supabase.storage.from('eoconnect-media').getPublicUrl(path).data.publicUrl
      }

      // Pull selected logo/cover File objects via the input refs.
      const logoFile = logoInputRef.current?.files?.[0]
      const coverFile = coverInputRef.current?.files?.[0]

      let logo_url: string | undefined
      let cover_url: string | undefined
      let newPortfolioUrls: string[] = []
      try {
        const [logoUploaded, coverUploaded, portfolioUploaded] = await Promise.all([
          logoFile ? uploadFile(logoFile, 'logos') : Promise.resolve(undefined),
          coverFile ? uploadFile(coverFile, 'covers') : Promise.resolve(undefined),
          Promise.all(portfolioFiles.map(f => uploadFile(f, 'portfolio'))),
        ])
        logo_url = logoUploaded
        cover_url = coverUploaded
        newPortfolioUrls = portfolioUploaded
      } catch (err) {
        setError(err instanceof Error ? err.message : 'File upload failed')
        return
      }

      const fd = new FormData(formEl)
      formData.category_ids.forEach(id => fd.append('category_ids', id))
      if (logo_url) fd.set('logo_url', logo_url)
      if (cover_url) fd.set('cover_url', cover_url)
      newPortfolioUrls.forEach(url => fd.append('portfolio_url', url))
      portfolioExisting.forEach(url => fd.append('portfolio_keep', url))

      const result: BusinessActionResult = await updateBusiness(business.id, fd)
      if (result?.error) {
        setError(result.error)
      } else {
        setSuccess(true)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="border-primary/50 bg-primary/10">
          <AlertDescription className="text-primary font-medium">Business profile updated successfully.</AlertDescription>
        </Alert>
      )}

      {/* Basic Info */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Basic Information</h2>
        <div className="space-y-2">
          <Label htmlFor="name">Business Name *</Label>
          <Input id="name" name="name" value={formData.name} onChange={e => update('name', e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tagline">Tagline</Label>
          <Input id="tagline" name="tagline" value={formData.tagline} onChange={e => update('tagline', e.target.value)} placeholder="One-line description" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" value={formData.description} onChange={e => update('description', e.target.value)} rows={5} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="founded_year">Founded Year</Label>
            <Input id="founded_year" name="founded_year" type="number" value={formData.founded_year} onChange={e => update('founded_year', e.target.value)} min="1900" max={new Date().getFullYear()} />
          </div>
          <div className="space-y-2">
            <Label>Team Size</Label>
            <Select value={formData.team_size || undefined} onValueChange={(v: string | null) => update('team_size', v ?? '')}>
              <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
              <SelectContent>
                {TEAM_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <input type="hidden" name="team_size" value={formData.team_size} />
          </div>
        </div>
        <LocationPicker
          countryCode={formData.country_code}
          city={formData.city}
          onChange={(loc) => setFormData(prev => ({
            ...prev,
            country_code: loc.countryCode,
            country: loc.countryName,
            city: loc.city,
          }))}
        />
        <input type="hidden" name="city" value={formData.city} />
        <input type="hidden" name="country" value={formData.country} />
        <input type="hidden" name="country_code" value={formData.country_code} />
      </div>

      {/* Categories & Tags */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Categories & Keywords</h2>
        <div>
          <Label className="mb-2 block">Categories (up to 3)</Label>
          <div className="grid grid-cols-2 gap-2">
            {categories.map(cat => (
              <div
                key={cat.id}
                onClick={() => toggleCategory(cat.id)}
                className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg cursor-pointer hover:border-primary transition-colors"
              >
                <Checkbox
                  checked={formData.category_ids.includes(cat.id)}
                  onCheckedChange={() => toggleCategory(cat.id)}
                />
                <span className="text-sm">{cat.icon} {cat.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tags">Keywords / Tags</Label>
          <Input id="tags" name="tags" value={formData.tags} onChange={e => update('tags', e.target.value)} placeholder="SaaS, fintech, B2B (comma-separated)" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="website">Website</Label>
          <Input id="website" name="website" type="url" value={formData.website} onChange={e => update('website', e.target.value)} placeholder="https://yourcompany.com" />
        </div>
      </div>

      {/* Contact */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Contact Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="email">Business Email</Label>
            <Input id="email" name="email" type="email" value={formData.email} onChange={e => update('email', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" value={formData.phone} onChange={e => update('phone', e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="social_linkedin">LinkedIn</Label>
          <Input id="social_linkedin" name="social_linkedin" value={formData.social_linkedin} onChange={e => update('social_linkedin', e.target.value)} placeholder="https://linkedin.com/company/yourco" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="social_twitter">X (Twitter)</Label>
          <Input id="social_twitter" name="social_twitter" value={formData.social_twitter} onChange={e => update('social_twitter', e.target.value)} placeholder="https://x.com/yourco" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="social_instagram">Instagram</Label>
          <Input id="social_instagram" name="social_instagram" value={formData.social_instagram} onChange={e => update('social_instagram', e.target.value)} placeholder="https://instagram.com/yourco" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="social_facebook">Facebook</Label>
          <Input id="social_facebook" name="social_facebook" value={formData.social_facebook} onChange={e => update('social_facebook', e.target.value)} placeholder="https://facebook.com/yourco" />
        </div>
      </div>

      {/* Media */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Media</h2>
        <p className="text-xs text-muted-foreground">Click to upload a new file. Leave empty to keep current.</p>

        {/* Logo */}
        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-4">
            <div
              className="relative h-20 w-20 rounded-xl border-2 border-border overflow-hidden flex-shrink-0 bg-muted cursor-pointer hover:border-primary transition-colors"
              onClick={() => logoInputRef.current?.click()}
            >
              {logoPreview ? (
                <img src={logoPreview} alt="Logo preview" className="w-full h-full object-cover" />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
            </div>
            <div>
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="text-sm text-primary hover:underline font-medium"
              >
                {logoPreview ? 'Change logo' : 'Upload logo'}
              </button>
              <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG up to 5MB · Recommended: 400×400px</p>
              {logoPreview && logoPreview !== business.logo_url && (
                <p className="text-xs text-primary mt-0.5">New file selected ✓</p>
              )}
            </div>
            <input
              ref={logoInputRef}
              name="logo"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) setLogoPreview(URL.createObjectURL(file))
              }}
            />
          </div>
        </div>

        {/* Cover */}
        <div className="space-y-2">
          <Label>Cover Image</Label>
          <div
            className="relative w-full h-36 rounded-xl border-2 border-dashed border-border overflow-hidden cursor-pointer hover:border-primary transition-colors bg-muted"
            onClick={() => coverInputRef.current?.click()}
          >
            {coverPreview ? (
              <>
                <img src={coverPreview} alt="Cover preview" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-2 text-white text-sm font-medium">
                    <Upload className="h-4 w-4" /> Change cover
                  </div>
                </div>
              </>
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center gap-2">
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Upload cover (1200×400 recommended)</span>
              </div>
            )}
            {coverPreview && coverPreview !== business.cover_url && (
              <span className="absolute bottom-2 right-2 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">New file selected ✓</span>
            )}
          </div>
          <input
            ref={coverInputRef}
            name="cover"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) setCoverPreview(URL.createObjectURL(file))
            }}
          />
        </div>

        {/* Portfolio — PDF documents (legacy image URLs still render) */}
        <div className="space-y-2">
          <Label>Portfolio Documents (up to 5 PDFs)</Label>
          <p className="text-xs text-muted-foreground">Case studies, decks, capability statements.</p>

          {/* Existing items — could be PDFs (new) or images (legacy) */}
          {portfolioExisting.length > 0 && (
            <div className="space-y-2 mt-1">
              {portfolioExisting.map((src, i) => {
                const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(src)
                const filename = (() => {
                  try { return decodeURIComponent(src.split('/').pop() ?? '').split('?')[0] || `Document ${i + 1}` }
                  catch { return `Document ${i + 1}` }
                })()
                return (
                  <div key={`existing-${i}`} className="flex items-center gap-3 p-3 bg-background border border-border rounded-lg">
                    {isImage ? (
                      <ImageIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <FileText className="h-5 w-5 text-primary flex-shrink-0" />
                    )}
                    <a href={src} target="_blank" rel="noopener noreferrer" className="text-sm font-medium truncate hover:text-primary flex-1 min-w-0">
                      {filename}
                    </a>
                    <button
                      type="button"
                      onClick={() => removeExistingPortfolio(i)}
                      className="text-muted-foreground hover:text-destructive p-1"
                      aria-label="Remove document"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* New uploads in this session */}
          {portfolioFiles.length > 0 && (
            <div className="space-y-2 mt-1">
              {portfolioFiles.map((file, i) => (
                <div key={`new-${i}`} className="flex items-center gap-3 p-3 bg-background border border-primary/40 rounded-lg">
                  <FileText className="h-5 w-5 text-primary flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB · pending upload</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeNewPortfolio(i)}
                    className="text-muted-foreground hover:text-destructive p-1"
                    aria-label="Remove document"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {(portfolioExisting.length + portfolioFiles.length) < 5 && (
            <div
              className="flex flex-col items-center gap-2 p-5 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary transition-colors"
              onClick={() => portfolioInputRef.current?.click()}
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {portfolioExisting.length + portfolioFiles.length > 0
                  ? `Add more PDFs (${5 - portfolioExisting.length - portfolioFiles.length} remaining)`
                  : 'Upload portfolio PDFs'}
              </span>
            </div>
          )}
          <input
            ref={portfolioInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={handlePortfolioChange}
          />
        </div>
      </div>

      <Button type="submit" disabled={isPending} className="w-full bg-primary text-primary-foreground font-bold py-3">
        {isPending ? 'Saving…' : 'Save Changes'}
      </Button>

      {/* Danger zone — owner-only delete. Lives at the bottom of the edit
          form because a destructive action belongs furthest from any
          casual click. Opens a confirmation modal that requires typing
          the business name to enable the delete button. */}
      <div className="mt-12 border-2 border-destructive/40 rounded-xl p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Permanently delete this business and everything tied to it: services,
            portfolio documents, reviews, analytics, and any active ad campaigns.
            Conversations are kept but will no longer reference this listing.
          </p>
        </div>
        <DeleteBusinessButton businessId={business.id} businessName={business.name ?? ''} />
      </div>
    </form>
  )
}
