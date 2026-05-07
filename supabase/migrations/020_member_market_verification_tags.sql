-- ============================================================
-- 020_member_market_verification_tags.sql
-- Extends profiles and businesses for Member Market scope.
-- tenant_id added everywhere — YPO ready, EO first.
-- ============================================================

-- Profiles extensions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'eo',
  ADD COLUMN IF NOT EXISTS verification_tag text NOT NULL DEFAULT 'unverified'
    CHECK (verification_tag = ANY (ARRAY[
      'unverified',
      'eo_member', 'eo_accelerator', 'eo_alumni', 'eo_sponsor',
      'ypo_member', 'ypo_alumni', 'ypo_sponsor'
    ])),
  ADD COLUMN IF NOT EXISTS member_flags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS slow_replier boolean DEFAULT false;

-- Businesses extensions
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'eo',
  ADD COLUMN IF NOT EXISTS verification_tag text NOT NULL DEFAULT 'unverified'
    CHECK (verification_tag = ANY (ARRAY[
      'unverified',
      'eo_member', 'eo_accelerator', 'eo_alumni', 'eo_sponsor',
      'ypo_member', 'ypo_alumni', 'ypo_sponsor'
    ])),
  ADD COLUMN IF NOT EXISTS boost_level integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_spotlight boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pre_populated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS slow_replier boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS claim_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS claim_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_email_count integer DEFAULT 0;

-- Services extensions
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS item_type text DEFAULT 'service'
    CHECK (item_type = ANY (ARRAY['service', 'product'])),
  ADD COLUMN IF NOT EXISTS offer_text text;

-- Indexes
CREATE INDEX IF NOT EXISTS profiles_tenant_idx
  ON public.profiles (tenant_id);

CREATE INDEX IF NOT EXISTS profiles_verification_tag_idx
  ON public.profiles (verification_tag);

CREATE INDEX IF NOT EXISTS profiles_slow_replier_idx
  ON public.profiles (slow_replier)
  WHERE slow_replier = true;

CREATE INDEX IF NOT EXISTS businesses_tenant_idx
  ON public.businesses (tenant_id);

CREATE INDEX IF NOT EXISTS businesses_verification_tag_idx
  ON public.businesses (verification_tag);

CREATE INDEX IF NOT EXISTS businesses_slow_replier_idx
  ON public.businesses (slow_replier)
  WHERE slow_replier = true;

CREATE INDEX IF NOT EXISTS businesses_is_pre_populated_idx
  ON public.businesses (is_pre_populated)
  WHERE is_pre_populated = true;