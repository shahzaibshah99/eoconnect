import { createClient } from '@/lib/supabase/server'
import { after } from 'next/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MapPin, Globe, Phone, Mail, Calendar, Users, FileText, ExternalLink, Handshake } from 'lucide-react'

// Inline brand SVGs — Lucide 1.x dropped brand icons into a separate package.
const LinkedinIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M19 0H5a5 5 0 0 0-5 5v14a5 5 0 0 0 5 5h14a5 5 0 0 0 5-5V5a5 5 0 0 0-5-5zM8 19H5V8h3v11zM6.5 6.732c-.966 0-1.75-.79-1.75-1.766s.784-1.766 1.75-1.766 1.75.79 1.75 1.766-.783 1.766-1.75 1.766zM20 19h-3v-5.604c0-3.368-4-3.113-4 0V19h-3V8h3v1.765c1.396-2.586 7-2.777 7 2.476V19z"/>
  </svg>
)
const TwitterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
)
const InstagramIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849s-.012 3.584-.069 4.849c-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
  </svg>
)
const FacebookIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
)
import { InquiryDialog } from '@/components/marketplace/inquiry-dialog'
import { FlagDialog } from '@/components/marketplace/flag-dialog'
import { EndorsementForm } from '@/components/marketplace/endorsement-form'
import { EndorsementDisplay } from '@/components/marketplace/endorsement-display'
import { externalUrl } from '@/lib/external-url'
import { BackButton } from '@/components/marketplace/back-button'
import { cn } from '@/lib/utils'

const MEMBERSHIP_LABEL: Record<string, string> = {
  current_member: 'Current EO Member',
  alumni: 'EO Alumni',
  accelerator: 'EO Accelerator',
}

interface ListingDetailProps {
  params: Promise<{ listingId: string }>
}

export default async function ListingDetailPage({ params }: ListingDetailProps) {
  const { listingId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [{ data: business }, { data: services }, { data: categories }, { data: endorsements }] = await Promise.all([
    db.from('businesses').select('*, profiles!owner_id(full_name, avatar_url, eo_chapter, eo_membership_type, linkedin_url, eo_membership_email, phone, contact_visibility)').eq('id', listingId).eq('status', 'published').single(),
    db.from('services').select('*').eq('business_id', listingId).eq('status', 'published'),
    supabase.from('categories').select('id, name').eq('active', true),
    db.from('endorsements')
      .select('id, from_member_id, text, created_at, profiles!from_member_id(full_name, avatar_url, eo_chapter, eo_membership_type)')
      .eq('business_id', listingId)
      .order('created_at', { ascending: false }),
  ])

  if (!business) notFound()

  // Analytics + ad personalization run AFTER the response is sent.
  // Earlier code didn't await the rpc(); supabase-js only fires the HTTP
  // call when awaited, and serverless functions terminate before unawaited
  // promises execute, so nothing was ever recorded. after() runs it
  // post-response and logs any error so we can see RPC issues.
  // Skip self-views — owners shouldn't pad their own view counts.
  const isViewerOwner = user?.id === business.owner_id
  after(async () => {
    try {
      if (!isViewerOwner) {
        const { error } = await db.rpc('increment_listing_stat', { p_business_id: listingId, p_stat: 'views' })
        if (error) console.error('[analytics] views rpc error:', error)
      }
      if (user && business.category_ids?.length > 0) {
        await db.rpc('increment_user_category_view', { p_category_ids: business.category_ids })
      }
    } catch (err) {
      console.error('[analytics] listing-view side-effects failed:', err)
    }
  })


  const businessCategories = (categories as Array<{ id: string; name: string }> | null)
    ?.filter(c => business.category_ids?.includes(c.id)) ?? []

  const isOwner = user?.id === business.owner_id
  const portfolioUrls = (business.portfolio_urls ?? []) as string[]

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Back affordance — returns to the previous page (marketplace
          OR search results with the user's query intact). Lives on
          its own row above the cover so it isn't overlapped by the
          cover image (a previous -mb-4 tightening collapsed it
          underneath the cover's stacking context). */}
      <BackButton />

      {/* Cover + logo */}
      <div className="relative">
        {business.cover_url ? (
          <div className="relative h-48 md:h-64 rounded-2xl overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={business.cover_url} alt={business.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="h-48 md:h-64 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5" />
        )}
        <div className="absolute -bottom-8 left-6 h-24 w-24 rounded-xl border-2 border-border bg-card overflow-hidden shadow-md">
          {business.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.logo_url} alt="logo" className="w-full h-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-primary/20">
              <span className="text-primary font-bold text-xl">{business.name.charAt(0)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Business info + sidebar */}
      <div className="pt-10 flex flex-col md:flex-row md:items-start gap-6">
        <div className="flex-1">
          <h1 className="text-3xl font-extrabold">{business.name}</h1>
          {business.tagline && <p className="text-muted-foreground mt-1">{business.tagline}</p>}

          <div className="flex flex-wrap items-center gap-3 mt-3">
            {businessCategories.map(cat => (
              <Badge key={cat.id} variant="secondary">{cat.name}</Badge>
            ))}
            {(business.city || business.country) && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {[business.city, business.country].filter(Boolean).join(', ')}
              </span>
            )}
          </div>

          {business.description && (
            <p className="mt-4 text-muted-foreground leading-relaxed">{business.description}</p>
          )}

          {business.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {business.tags.map((tag: string) => (
                <span key={tag} className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground">{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar CTA */}
        <div className="w-full md:w-72 flex-shrink-0 space-y-4">
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            {!isOwner && (
              <InquiryDialog
                businessId={business.id}
                ownerId={business.owner_id ?? ''}
                ownerName={business.profiles?.full_name ?? 'the owner'}
                businessName={business.name}
                services={(services ?? []).map((s: { id: string; title: string; item_type?: string | null }) => ({
                  id: s.id, title: s.title, item_type: s.item_type ?? null,
                }))}
              />
            )}
            {/* Flag this listing — per scope F06. Hidden from the listing owner. */}
            {user && !isOwner && (
              <div className="flex justify-end pt-1">
                <FlagDialog
                  targetType="listing"
                  targetId={business.id}
                  targetLabel={business.name}
                />
              </div>
            )}

            {(() => {
              const w = externalUrl(business.website)
              return w ? (
                <a
                  href={w}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: 'outline' }), 'w-full gap-2')}
                >
                  <Globe className="h-4 w-4" /> Visit Website
                </a>
              ) : null
            })()}

            <div className="pt-2 space-y-2 text-sm text-muted-foreground">
              {business.founded_year && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Founded {business.founded_year}</span>
                </div>
              )}
              {business.team_size && (
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5" />
                  <span>{business.team_size} employees</span>
                </div>
              )}
              {business.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  <span>{business.phone}</span>
                </div>
              )}
              {business.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5" />
                  <span>{business.email}</span>
                </div>
              )}
            </div>

            {/* Social icons — only render those that are populated.
                URLs are normalized through externalUrl() so legacy entries like
                "www.linkedin.com/in/foo" (no protocol) don't get treated as
                same-origin relative paths by the browser. */}
            {business.social_links && (() => {
              const socials = business.social_links as Record<string, string>
              const items: Array<{ key: string; url: string; Icon: (p: React.SVGProps<SVGSVGElement>) => React.JSX.Element; label: string }> = []
              const li = externalUrl(socials.linkedin); if (li) items.push({ key: 'linkedin', url: li, Icon: LinkedinIcon, label: 'LinkedIn' })
              const tw = externalUrl(socials.twitter);  if (tw) items.push({ key: 'twitter', url: tw, Icon: TwitterIcon, label: 'X / Twitter' })
              const ig = externalUrl(socials.instagram); if (ig) items.push({ key: 'instagram', url: ig, Icon: InstagramIcon, label: 'Instagram' })
              const fb = externalUrl(socials.facebook); if (fb) items.push({ key: 'facebook', url: fb, Icon: FacebookIcon, label: 'Facebook' })
              if (items.length === 0) return null
              return (
                <div className="pt-3 border-t border-border flex items-center gap-2">
                  {items.map(s => (
                    <a
                      key={s.key}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={s.label}
                      className="h-8 w-8 rounded-lg bg-muted hover:bg-primary/20 hover:text-primary text-muted-foreground flex items-center justify-center transition-colors"
                    >
                      <s.Icon className="h-4 w-4" />
                    </a>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Listed by — owner card */}
          {business.profiles && (
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Listed by</p>
              <div className="flex items-center gap-3">
                <Avatar className="h-11 w-11">
                  <AvatarImage src={business.profiles.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-primary/15 text-primary text-sm font-bold">
                    {(business.profiles.full_name ?? '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-sm truncate">{business.profiles.full_name}</p>
                    {(() => {
                      const url = externalUrl(business.profiles.linkedin_url)
                      return url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${business.profiles.full_name ?? 'Owner'} on LinkedIn`}
                          className="text-muted-foreground hover:text-[#0A66C2] transition-colors"
                        >
                          <LinkedinIcon className="h-3.5 w-3.5 fill-current" />
                        </a>
                      ) : null
                    })()}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    {business.profiles.eo_membership_type && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {MEMBERSHIP_LABEL[business.profiles.eo_membership_type] ?? business.profiles.eo_membership_type}
                      </Badge>
                    )}
                    {business.profiles.eo_chapter && (
                      <span className="text-xs text-muted-foreground">{business.profiles.eo_chapter}</span>
                    )}
                  </div>
                  {(() => {
                    const cv = business.profiles.contact_visibility as { email?: boolean; phone?: boolean } | null
                    return (
                      <div className="space-y-1 mt-1.5">
                        {cv?.email && business.profiles.eo_membership_email && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3 shrink-0" />
                            <span className="truncate">{business.profiles.eo_membership_email}</span>
                          </div>
                        )}
                        {cv?.phone && business.profiles.phone && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3 shrink-0" />
                            <span>{business.profiles.phone}</span>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Portfolio Documents */}
      {portfolioUrls.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4">Portfolio Documents</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {portfolioUrls.map((url, i) => {
              const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)
              const filename = (() => {
                try {
                  const last = decodeURIComponent(url.split('/').pop() ?? '').split('?')[0]
                  // Storage paths are prefixed with `<timestamp>-<random>-<safeName>`
                  // (e.g. "1777399978266-ag7hko-copy_of_private_ai_white_paper.pdf").
                  // Strip the bookkeeping prefix so the user sees just the original
                  // filename. Pattern: digits-then-alphanum-then-hyphen at the start.
                  const cleaned = last.replace(/^\d{10,}-[a-z0-9]+-/i, '')
                  // Also turn underscores back into spaces for readability (we
                  // sanitized them on upload).
                  const human = cleaned.replace(/_/g, ' ')
                  return human || `Document ${i + 1}`
                } catch {
                  return `Document ${i + 1}`
                }
              })()

              if (isImage) {
                // Legacy image-based portfolio entries — still render as thumbnails
                return (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                     className="relative h-40 rounded-xl overflow-hidden bg-muted block group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={filename} className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]" />
                  </a>
                )
              }

              // PDF preview card — embed first page, then filename row below.
              // PDF URL hash params (#toolbar=0&navpanes=0...) suppress the
              // built-in viewer chrome so the inline preview reads as a
              // thumbnail. <object> is used over <iframe> so we get a clean
              // fallback (FileText icon) on browsers that can't render PDFs
              // inline (older mobile Safari, some embedded webviews).
              const previewSrc = `${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`
              return (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-card border border-border rounded-xl overflow-hidden hover:border-primary transition-colors group"
                >
                  <div className="relative h-56 bg-muted overflow-hidden">
                    <object
                      data={previewSrc}
                      type="application/pdf"
                      className="w-full h-full pointer-events-none"
                      aria-label={`Preview of ${filename}`}
                    >
                      {/* Fallback if browser can't render embedded PDFs */}
                      <div className="flex items-center justify-center h-full">
                        <FileText className="h-12 w-12 text-muted-foreground" />
                      </div>
                    </object>
                    {/* Click-catcher so taps anywhere open the full PDF in a new tab */}
                    <div className="absolute inset-0" />
                  </div>
                  <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
                    <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                    <p className="font-medium text-sm truncate flex-1 group-hover:text-primary transition-colors">
                      {filename}
                    </p>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  </div>
                </a>
              )
            })}
          </div>
        </section>
      )}

      {/* Services */}
      {services && services.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4">Services</h2>
          <div className="grid gap-4">
            {services.map((service: { id: string; title: string; description?: string; pricing_model: string; price_from?: number; price_to?: number; thumbnail_url?: string | null }) => (
              <div key={service.id} className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-start gap-4">
                  {service.thumbnail_url && (
                    <div className="relative h-20 w-28 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={service.thumbnail_url} alt={service.title} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">{service.title}</h3>
                    {service.description && (
                      <p className="text-sm text-muted-foreground mt-1">{service.description}</p>
                    )}
                  </div>
                  {service.pricing_model !== 'contact' && service.price_from != null && (
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold">
                        ${service.price_from.toLocaleString()}
                        {service.price_to ? `–$${service.price_to.toLocaleString()}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">{service.pricing_model}</p>
                    </div>
                  )}
                  {service.pricing_model === 'contact' && (
                    <Badge variant="outline" className="flex-shrink-0">Contact for pricing</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* I've Worked With Endorsements */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Handshake className="h-5 w-5" />
          <h2 className="text-xl font-bold">I&apos;ve Worked With</h2>
        </div>

        {!isOwner && user && (
          <div className="mb-6">
            <EndorsementForm businessId={business.id} />
          </div>
        )}

        {endorsements && endorsements.length > 0 ? (
          <EndorsementDisplay
            endorsements={endorsements as import('@/components/marketplace/endorsement-display').EndorsementItem[]}
            businessName={business.name}
          />
        ) : (
          <p className="text-muted-foreground text-sm">No endorsements yet. Be the first to share your experience working with this business!</p>
        )}
      </section>
    </div>
  )
}
