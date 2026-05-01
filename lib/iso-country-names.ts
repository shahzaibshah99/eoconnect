/**
 * ISO 3166-1 alpha-2 country code → display name.
 *
 * Used by the LinkedIn auto-fill flow: LinkedIn returns headquarters
 * locations as ISO-2 codes (e.g. "US", "AU") but our business form's
 * `country` field stores human-readable names ("United States",
 * "Australia"). This is the lookup that bridges them.
 *
 * Coverage: every country with an EO chapter (per migration 009 seed)
 * plus the major countries members are likely to operate from. If a
 * code isn't here we return the code itself so the user can hand-fix
 * in the wizard rather than seeing a broken-looking empty field.
 */
const ISO2_NAMES: Record<string, string> = {
  AE: 'United Arab Emirates',
  AF: 'Afghanistan',
  AR: 'Argentina',
  AT: 'Austria',
  AU: 'Australia',
  BD: 'Bangladesh',
  BE: 'Belgium',
  BG: 'Bulgaria',
  BH: 'Bahrain',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CL: 'Chile',
  CN: 'China',
  CO: 'Colombia',
  CR: 'Costa Rica',
  CZ: 'Czech Republic',
  DE: 'Germany',
  DK: 'Denmark',
  DO: 'Dominican Republic',
  EC: 'Ecuador',
  EG: 'Egypt',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  GT: 'Guatemala',
  HK: 'Hong Kong',
  HU: 'Hungary',
  ID: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IN: 'India',
  IT: 'Italy',
  JO: 'Jordan',
  JP: 'Japan',
  KE: 'Kenya',
  KR: 'South Korea',
  KW: 'Kuwait',
  LB: 'Lebanon',
  LK: 'Sri Lanka',
  MA: 'Morocco',
  MX: 'Mexico',
  MY: 'Malaysia',
  NG: 'Nigeria',
  NL: 'Netherlands',
  NO: 'Norway',
  NZ: 'New Zealand',
  PA: 'Panama',
  PE: 'Peru',
  PH: 'Philippines',
  PK: 'Pakistan',
  PL: 'Poland',
  PR: 'Puerto Rico',
  PT: 'Portugal',
  PY: 'Paraguay',
  QA: 'Qatar',
  RO: 'Romania',
  RU: 'Russia',
  SA: 'Saudi Arabia',
  SE: 'Sweden',
  SG: 'Singapore',
  TH: 'Thailand',
  TR: 'Turkey',
  TW: 'Taiwan',
  UA: 'Ukraine',
  UG: 'Uganda',
  US: 'United States',
  UY: 'Uruguay',
  VN: 'Vietnam',
  ZA: 'South Africa',
}

export function iso2ToCountryName(code: string | null | undefined): string {
  if (!code) return ''
  const upper = code.trim().toUpperCase()
  return ISO2_NAMES[upper] ?? upper
}
