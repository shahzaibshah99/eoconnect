/**
 * Current terms version. Bump whenever terms copy changes materially.
 * Members with terms_version < CURRENT_TERMS_VERSION are shown the
 * T&C acceptance wall on their next login.
 *
 * Lives in lib/ rather than actions/terms.ts because Next.js 16's
 * "use server" rule forbids non-function exports from action files.
 * Import from here in both the layout (intercept check) and the
 * accept-terms page (redirect guard).
 */
export const CURRENT_TERMS_VERSION = 1
