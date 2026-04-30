import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Plus, Building2 } from 'lucide-react'
import type { Service } from '@/types/database'
import { ServiceActions } from './service-actions'

function formatPrice(service: Pick<Service, 'pricing_model' | 'price_from' | 'price_to'>) {
  if (service.pricing_model === 'contact' || !service.price_from) return 'Contact for pricing'
  const from = `$${service.price_from.toLocaleString()}`
  const to = service.price_to ? `–$${service.price_to.toLocaleString()}` : ''
  return `${from}${to} / ${service.pricing_model}`
}

export default async function ListingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: businesses } = await db
    .from('businesses')
    .select('id, name, logo_url')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false }) as {
      data: Array<{ id: string; name: string; logo_url: string | null }> | null
    }

  const bizList = businesses ?? []

  if (bizList.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Manage Services</h1>
        <div className="bg-card border border-border rounded-2xl p-8 text-center mt-6">
          <h2 className="text-lg font-semibold mb-2">No business profile yet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            You need a business profile before adding services.
          </p>
          <Link
            href="/dashboard/business/new"
            className={cn(buttonVariants(), 'bg-primary text-primary-foreground font-bold')}
          >
            Create Business Profile
          </Link>
        </div>
      </div>
    )
  }

  const { data: services } = await db
    .from('services')
    .select('*')
    .in('business_id', bizList.map(b => b.id))
    .order('created_at', { ascending: false }) as { data: Service[] | null }

  const servicesByBusiness = new Map<string, Service[]>()
  for (const s of services ?? []) {
    const list = servicesByBusiness.get(s.business_id) ?? []
    list.push(s)
    servicesByBusiness.set(s.business_id, list)
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Manage Services</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {bizList.length} business{bizList.length === 1 ? '' : 'es'} · {services?.length ?? 0} service{(services?.length ?? 0) === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/dashboard/business/new"
          className={cn(buttonVariants({ variant: 'outline' }), 'gap-1.5')}
        >
          <Plus className="h-4 w-4" /> Add Business
        </Link>
      </div>

      <div className="space-y-8">
        {bizList.map(biz => {
          const bizServices = servicesByBusiness.get(biz.id) ?? []
          return (
            <section key={biz.id}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {biz.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={biz.logo_url} alt={biz.name} className="w-full h-full object-cover" />
                    ) : (
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-semibold truncate">{biz.name}</h2>
                    <Link href={`/dashboard/business/edit/${biz.id}`} className="text-xs text-primary hover:underline">
                      Edit business →
                    </Link>
                  </div>
                </div>
                {bizServices.length >= 3 ? (
                  <span className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-md flex-shrink-0">
                    Max 3 services
                  </span>
                ) : (
                  <Link
                    href={`/dashboard/services/new?business=${biz.id}`}
                    className={cn(buttonVariants({ size: 'sm' }), 'bg-primary text-primary-foreground font-bold gap-1 flex-shrink-0')}
                  >
                    + Add Service ({bizServices.length}/3)
                  </Link>
                )}
              </div>

              {bizServices.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
                  No services on this business yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {bizServices.map(service => (
                    <div
                      key={service.id}
                      className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {service.thumbnail_url && (
                          <div className="relative h-12 w-16 rounded-md overflow-hidden bg-muted flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={service.thumbnail_url} alt={service.title} className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-sm truncate">{service.title}</h3>
                            <span className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
                              service.status === 'published'
                                ? 'bg-primary/20 text-primary'
                                : 'bg-muted text-muted-foreground'
                            )}>
                              {service.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{formatPrice(service)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/dashboard/services/${service.id}`}
                          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                        >
                          Edit
                        </Link>
                        <ServiceActions serviceId={service.id} serviceTitle={service.title} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
