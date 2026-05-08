export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type UserRole = 'member' | 'chapter_admin' | 'super_admin'
export type UserStatus = 'pending' | 'active' | 'suspended'
export type EoMembershipType = 'current_member' | 'alumni' | 'accelerator'
export type BusinessStatus = 'draft' | 'published' | 'paused'
export type PricingModel = 'fixed' | 'hourly' | 'project' | 'contact'
export type AdGoal = 'more_views' | 'sponsored_search'
export type AdFormat = 'banner' | 'sponsored_listing'
export type AdStatus = 'draft' | 'pending_review' | 'active' | 'paused' | 'completed' | 'rejected'
export type TeamSize = '1-10' | '11-50' | '51-200' | '201-500' | '500+'

export type VerificationTag =
  | 'unverified'
  | 'eo_member' | 'eo_accelerator' | 'eo_alumni' | 'eo_sponsor'
  | 'ypo_member' | 'ypo_alumni' | 'ypo_sponsor'

export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  eo_chapter: string | null
  eo_membership_email: string | null
  eo_membership_type: EoMembershipType | null
  country: string | null
  onboarded_at: string | null
  role: UserRole
  status: UserStatus
  /** Member Market verification tag (migration 020). 'unverified' is the default. */
  verification_tag: VerificationTag
  /** 'eo' or 'ypo'. Drives tag vocabulary and tenant scoping. */
  tenant_id: string
  created_at: string
  /** Timestamp of when the member last opened the notifications
   *  bell. Reviews on the member's listings created after this
   *  show as unread. Set by markNotificationsRead. */
  notifications_seen_at: string | null
}

export interface Category {
  id: string
  name: string
  slug: string
  parent_id: string | null
  icon: string | null
  sort_order: number
  active: boolean
  created_at: string
}

export interface Business {
  id: string
  /** Nullable for pre-populated listings created via CSV import (F03)
   *  before a member claims them. Real members always have owner_id set. */
  owner_id: string | null
  name: string
  tagline: string | null
  description: string | null
  website: string | null
  founded_year: number | null
  team_size: TeamSize | null
  city: string | null
  country: string | null
  logo_url: string | null
  cover_url: string | null
  portfolio_urls: string[]
  phone: string | null
  email: string | null
  social_links: Json
  status: BusinessStatus
  /** Who paused the listing. Null when status is not 'paused'. */
  paused_by: 'owner' | 'admin' | null
  category_ids: string[]
  tags: string[]
  /** F02: 90 days no owner login → greyed in search but still accessible. */
  slow_replier: boolean
  /** F03: true while a pre-populated listing is awaiting a real-member claim. */
  is_pre_populated: boolean
  created_at: string
  updated_at: string
}

export interface Service {
  id: string
  business_id: string
  title: string
  description: string | null
  pricing_model: PricingModel | null
  price_from: number | null
  price_to: number | null
  thumbnail_url: string | null
  status: 'draft' | 'published'
  /** F02: discriminator added in migration 020. Existing rows default
   *  to 'service' to preserve backwards-compatibility. */
  item_type: 'service' | 'product'
  /** F02 + F20: paid-tier offer attached to this service/product.
   *  Null until the member upgrades and the member_offers flag flips on. */
  offer_text: string | null
  created_at: string
}

export interface ListingAnalytics {
  id: string
  business_id: string
  date: string
  views: number
  search_appearances: number
  contact_clicks: number
}

export interface Review {
  id: string
  business_id: string
  reviewer_id: string
  rating: number
  body: string | null
  owner_reply: string | null
  flagged: boolean
  created_at: string
  reviewer?: Profile
}

export interface Conversation {
  id: string
  participant_ids: string[]
  listing_id: string | null
  last_message_at: string
  created_at: string
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  read_at: string | null
  created_at: string
  sender?: Profile
}

export interface AdCampaign {
  id: string
  business_id: string
  goal: AdGoal | null
  format: AdFormat | null
  target_category_ids: string[]
  target_keywords: string[]
  budget_total: number | null
  budget_daily: number | null
  spend_to_date: number
  start_date: string | null
  end_date: string | null
  status: AdStatus
  creative_url: string | null
  stripe_payment_intent_id: string | null
  impressions: number
  clicks: number
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> }
      categories: { Row: Category; Insert: Partial<Category>; Update: Partial<Category> }
      businesses: { Row: Business; Insert: Partial<Business>; Update: Partial<Business> }
      services: { Row: Service; Insert: Partial<Service>; Update: Partial<Service> }
      listing_analytics: { Row: ListingAnalytics; Insert: Partial<ListingAnalytics>; Update: Partial<ListingAnalytics> }
      reviews: { Row: Review; Insert: Partial<Review>; Update: Partial<Review> }
      conversations: { Row: Conversation; Insert: Partial<Conversation>; Update: Partial<Conversation> }
      messages: { Row: Message; Insert: Partial<Message>; Update: Partial<Message> }
      ad_campaigns: { Row: AdCampaign; Insert: Partial<AdCampaign>; Update: Partial<AdCampaign> }
    }
  }
}
