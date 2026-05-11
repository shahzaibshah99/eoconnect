/**
 * Verification tier ordering used in both bulletin matching and search ranking.
 * Lower number = higher tier = appears earlier.
 */
export const VERIFICATION_TIER: Record<string, number> = {
  eo_member: 0,
  eo_accelerator: 1,
  eo_alumni: 2,
  eo_sponsor: 3,
  ypo_member: 0,
  ypo_alumni: 1,
  ypo_sponsor: 2,
  unverified: 99,
}

/** Scope F04: cap on businesses notified per bulletin post. */
export const BULLETIN_MATCH_CAP = 6

/** Scope F04: thread collapses visually after this many replies. */
export const THREAD_COLLAPSE_AFTER = 3
