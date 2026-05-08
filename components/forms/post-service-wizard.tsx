'use client'

import { useState, useTransition, useRef } from 'react'
import { createService } from '@/actions/services'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { ChevronRight, ChevronLeft, Upload } from 'lucide-react'

const STEPS = ['Service Details', 'Review & Add']

type PricingModel = 'fixed' | 'hourly' | 'project' | 'contact'
type ItemType = 'service' | 'product'

interface FormData {
  title: string
  description: string
  pricing_model: PricingModel | ''
  price_from: string
  price_to: string
  item_type: ItemType
}

interface PostServiceWizardProps {
  businessId: string
  onSuccess: () => void
}

export function PostServiceWizard({ businessId, onSuccess }: PostServiceWizardProps) {
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [formData, setFormData] = useState<FormData>({
    title: '',
    description: '',
    pricing_model: '',
    price_from: '',
    price_to: '',
    item_type: 'service',
  })
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const thumbnailInputRef = useRef<HTMLInputElement>(null)

  const update = (key: keyof FormData, value: string) =>
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
    const fd = new FormData()
    fd.set('title', formData.title)
    fd.set('description', formData.description)
    fd.set('pricing_model', formData.pricing_model)
    fd.set('item_type', formData.item_type)
    if (formData.price_from) fd.set('price_from', formData.price_from)
    if (formData.price_to) fd.set('price_to', formData.price_to)
    if (thumbnailFile) fd.set('thumbnail', thumbnailFile)

    startTransition(async () => {
      const result = await createService(businessId, fd)
      if (result?.error) {
        setError(result.error)
      } else {
        onSuccess()
      }
    })
  }

  const progress = ((step + 1) / STEPS.length) * 100

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Step {step + 1} of {STEPS.length}</span>
          <span className="text-sm font-medium">{STEPS[step]}</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      <div className="bg-card border border-border rounded-2xl p-8">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Step 0: Service Details */}
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">{formData.item_type === 'product' ? 'Product Details' : 'Service Details'}</h2>
            <div className="space-y-2">
              <Label>What are you adding? *</Label>
              {/* Toggle between service and product. Stored as item_type
                  on the services row (column added in migration 020).
                  Defaults to 'service' for backwards-compat. */}
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
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={e => update('description', e.target.value)}
                placeholder="Describe what this service includes…"
                rows={4}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Pricing Model *</Label>
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
                  <Label htmlFor="price_from">Price From ($) *</Label>
                  <Input
                    id="price_from"
                    type="number"
                    min="0"
                    value={formData.price_from}
                    onChange={e => update('price_from', e.target.value)}
                    placeholder="100"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price_to">Price To ($) <span className="text-muted-foreground text-xs">(optional)</span></Label>
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
              <Label>Thumbnail Image <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
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
          </div>
        )}

        {/* Step 1: Review & Add */}
        {step === 1 && (
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Review & Add</h2>
              <div className="bg-background border border-border rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Title</span>
                  <span className="font-medium">{formData.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pricing</span>
                  <span>{formData.pricing_model || '—'}</span>
                </div>
                {showPriceFields && formData.price_from && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Price Range</span>
                    <span>
                      ${Number(formData.price_from).toLocaleString()}
                      {formData.price_to ? `–$${Number(formData.price_to).toLocaleString()}` : ''}
                    </span>
                  </div>
                )}
                {formData.description && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-muted-foreground text-xs mb-1">Description</p>
                    <p className="text-sm">{formData.description}</p>
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Your service will be published immediately and visible to other members.
              </p>
            </div>
            <div className="flex gap-3 mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(s => s - 1)}
                className="flex-1 gap-1"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="flex-1 bg-primary text-primary-foreground font-bold"
              >
                {isPending ? 'Adding…' : 'Add Service'}
              </Button>
            </div>
          </form>
        )}

        {/* Navigation (step 0 only) */}
        {step === 0 && (
          <div className="flex gap-3 mt-6">
            <Button
              type="button"
              onClick={() => {
                if (!formData.title.trim()) { setError('Service title is required'); return }
                if (!formData.description.trim()) { setError('Description is required'); return }
                if (!formData.pricing_model) { setError('Please select a pricing model'); return }
                if (showPriceFields && !formData.price_from) { setError('Price is required for this pricing model'); return }
                // Thumbnail is optional — listings can publish without one.
                setError(null)
                setStep(1)
              }}
              className="flex-1 bg-primary text-primary-foreground font-bold gap-1"
            >
              Continue <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
