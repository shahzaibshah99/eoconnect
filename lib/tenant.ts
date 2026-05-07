import 'server-only'

export type TenantId = 'eo' | 'ypo'

const VALID: TenantId[] = ['eo', 'ypo']

/**
 * Resolve the active tenant for this deployment.
 *
 * Per Member Market scope: each deployment runs against exactly one tenant
 * (its own Supabase project). The TENANT_ID env var labels rows, drives
 * tag vocabulary, and selects branding.
 *
 *   eo.member.market  → TENANT_ID=eo  → EO Supabase project
 *   ypo.member.market → TENANT_ID=ypo → YPO Supabase project
 *
 * Behavior:
 *   - Missing in production:        throws (mirrors siteUrl() — fail loud)
 *   - Missing in dev:                returns 'eo' (sensible default for the
 *                                    EO build that exists today)
 *   - Set to an unrecognised value:  throws regardless of env (typo guard)
 *
 * Server-only — never expose to the browser. The client doesn't need to
 * know its own tenant; the server already scopes every read/write.
 */
export function currentTenant(): TenantId {
  const raw = process.env.TENANT_ID?.trim().toLowerCase()
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TENANT_ID is not set in production')
    }
    return 'eo'
  }
  if (!VALID.includes(raw as TenantId)) {
    throw new Error(`TENANT_ID=${raw} is not recognised — expected one of: ${VALID.join(', ')}`)
  }
  return raw as TenantId
}
