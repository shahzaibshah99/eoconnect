/**
 * F02: hard cap on services+products combined per business listing.
 * Bumped from 3 → 8 in the launch scope.
 *
 * Lives in lib/ rather than actions/services.ts because Next.js 16's
 * "use server" rule forbids non-function exports from action files.
 * Both the server action and the dashboard UI import this constant
 * so the cap stays in one place.
 */
export const MAX_SERVICES_PER_BUSINESS = 8
