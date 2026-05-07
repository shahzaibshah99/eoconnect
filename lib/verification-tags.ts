/**
 * Verification tag vocabulary, scoped per tenant.
 *
 * 'unverified' is the default state on profile creation — never assigned
 * manually by an admin. Assignable tags are the rest, scoped to the
 * member's tenant_id ('eo' or 'ypo').
 */

export type VerificationTag =
  | 'unverified'
  | 'eo_member'
  | 'eo_accelerator'
  | 'eo_alumni'
  | 'eo_sponsor'
  | 'ypo_member'
  | 'ypo_alumni'
  | 'ypo_sponsor'

export type AssignableTag = Exclude<VerificationTag, 'unverified'>

export const VERIFICATION_TAG_LABEL: Record<VerificationTag, string> = {
  unverified: 'Unverified',
  eo_member: 'EO Member',
  eo_accelerator: 'EO Accelerator',
  eo_alumni: 'EO Alumni',
  eo_sponsor: 'EO Sponsor',
  ypo_member: 'YPO Member',
  ypo_alumni: 'YPO Alumni',
  ypo_sponsor: 'YPO Sponsor',
}

export const EO_TAGS: AssignableTag[] = ['eo_member', 'eo_accelerator', 'eo_alumni', 'eo_sponsor']
export const YPO_TAGS: AssignableTag[] = ['ypo_member', 'ypo_alumni', 'ypo_sponsor']

export function assignableTagsForTenant(tenantId: string): AssignableTag[] {
  return tenantId === 'ypo' ? YPO_TAGS : EO_TAGS
}

export function isAssignableTag(tag: string): tag is AssignableTag {
  return tag !== 'unverified' && (EO_TAGS as string[]).concat(YPO_TAGS as string[]).includes(tag)
}
