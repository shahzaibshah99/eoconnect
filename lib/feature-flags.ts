/**
 * Server-only feature flags.
 *
 * Toggle in Vercel → Settings → Environment Variables.
 * All paid/boost/offer flags default OFF — set to "true" to expose UI.
 *
 * Paid-tier flags must NOT be enabled until 2,500 active listings
 * are confirmed (per scope F20). ADS_ENABLED is independent.
 */

/** Sponsored ad campaigns — independent of listing count milestone. */
export const ADS_ENABLED = process.env.ADS_ENABLED === 'true'

/**
 * Paid member tier — offer/deal attachments on services.
 * Gate: 2,500+ active listings. Not marketed until milestone hit.
 */
export const PAID_TIER_ENABLED = process.env.PAID_TIER_ENABLED === 'true'

/**
 * Search ranking boost within verification tier (paid feature).
 * Gate: 2,500+ active listings.
 */
export const BOOST_ENABLED = process.env.BOOST_ENABLED === 'true'

/**
 * Member offers — deal/discount text attached to a service/product.
 * Gate: 2,500+ active listings.
 */
export const MEMBER_OFFERS_ENABLED = process.env.MEMBER_OFFERS_ENABLED === 'true'

/**
 * Spotlight — homepage featured member card + digest header.
 * Infrastructure ready (spotlight_schedule table, is_spotlight flag).
 * Enable when monetisation model is decided.
 */
export const SPOTLIGHT_ENABLED = process.env.SPOTLIGHT_ENABLED === 'true'
