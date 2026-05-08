'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { updateService } from '@/actions/services'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload } from 'lucide-react'
import type { Service } from '@/types/database'

type PricingModel = 'fixed' | 'hourly' | 'project' | 'contact'
type ItemType = 'service' | 'product'

interface EditServiceFormProps {
  service: Service
}

export function EditServiceForm({ service }: EditServiceFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(service.thumbnail_url ?? null)
  const thumbnailInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState({
    title: service.title,
    description: service.description ?? '',
    pricing_model: (service.pricing_model ?? '') as PricingModel | '',
    price_from: service.price_from?.toString() ?? '',
    price_to: service.price_to?.toString() ?? '',
    item_type: (service.item_type ?? 'service') as ItemType,
  })

  const update = (key: keyof typeof formData, value: string) =>
    setFormData(prev => ({ ...prev, [key]: value }))

  const showPriceFields = formData.pricing_model !== 'contact' && formData.pricing_model !== ''

  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setThumbnailFile(file)
    setThumbnailPreview(URL.createObjectURL(file))
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const fd = new FormData()
    fd.set('title', formData.title)
    fd.set('description', formData.description)
    fd.set('pricing_model', formData.pricing_model)
    fd.set('item_type', formData.item_type)
    if (formData.price_from) fd.set('price_from', formData.price_from)
    if (formData.price_to) fd.set('price_to', formData.price_to)
    if (thumbnailFile) fd.set('thumbnail', thumbnailFile)

    startTransition(async () => {
      const result = await updateService(service.id, fd)
      if (result?.error) {
        setError(result.error)
      } else {
        setSuccess(true)
        // MM-08: jump back to the services overview after a brief success flash
        router.push('/dashboard/services')
        router.refresh()
      }
    })
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-8">
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="mb-4">
          <AlertDescription>Service updated successfully.</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Type</Label>
          <div className="grid grid-cols-2 gap-2">
            {(['service', 'product'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, item_type: t }))}
                className={
                  'px-4 py-2.5 rounded-lg border text-sm font-medium capitalize transition-colors ' +
                  (formData.item_type === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted')
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="title">{formData.item_type === 'product' ? 'Product' : 'Service'} Title *</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={e => update('title', e.target.value)}
            placeholder={formData.item_type === 'product' ? 'e.g. Custom Branding Package' : 'e.g. Brand Strategy Consultation'}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={e => update('description', e.target.value)}
            placeholder="Describe what this service includes…"
            rows={4}
          />
        </div>

        <div className="space-y-2">
          <Label>Pricing Model</Label>
          <Select
            value={formData.pricing_model || undefined}
            onValueChange={(v: string | null) => update('pricing_model', v ?? '')}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select pricing model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixed Price</SelectItem>
              <SelectItem value="hourly">Hourly Rate</SelectItem>
              <SelectItem value="project">Per Project</SelectItem>
              <SelectItem value="contact">Contact for Pricing</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {showPriceFields && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price_from">Price From ($)</Label>
              <Input
                id="price_from"
                type="number"
                min="0"
                value={formData.price_from}
                onChange={e => update('price_from', e.target.value)}
                placeholder="100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price_to">
                Price To ($){' '}
                <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                id="price_to"
                type="number"
                min="0"
                value={formData.price_to}
                onChange={e => update('price_to', e.target.value)}
                placeholder="500"
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Thumbnail Image <span className="text-muted-foreground text-xs">(optional)</span></Label>
          <div className="flex items-center gap-4">
            <div
              onClick={() => thumbnailInputRef.current?.click()}
              className="relative h-20 w-28 rounded-lg border-2 border-dashed border-border overflow-hidden flex-shrink-0 bg-muted cursor-pointer hover:border-primary transition-colors"
            >
              {thumbnailPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnailPreview} alt="Thumbnail preview" className="w-full h-full object-cover" />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
            </div>
            <div>
              <button type="button" onClick={() => thumbnailInputRef.current?.click()} className="text-sm text-primary hover:underline font-medium">
                {thumbnailPreview ? 'Change image' : 'Upload image'}
              </button>
              <p className="text-xs text-muted-foreground mt-0.5">PNG or JPG · 4:3 ratio works best</p>
              {thumbnailFile && <p className="text-xs text-primary mt-0.5">{thumbnailFile.name} selected ✓</p>}
            </div>
            <input ref={thumbnailInputRef} type="file" accept="image/*" className="hidden" onChange={handleThumbnailChange} />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.history.back()}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            className="flex-1 bg-primary text-primary-foreground font-bold"
          >
            {isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
