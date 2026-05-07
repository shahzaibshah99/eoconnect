-- ============================================================
-- 021_member_market_new_tables.sql
-- Creates verifications, endorsements, feature_flags,
-- events_log, chapter_managers, spotlight_schedule tables.
-- All have tenant_id for future YPO support.
-- ============================================================

-- 1. Verifications
CREATE TABLE IF NOT EXISTS public.verifications (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id text NOT NULL DEFAULT 'eo',
  method text CHECK (method = ANY (ARRAY[
    'screenshot', 'linkedin', 'chapter_manager', 'peer'
  ])),
  screenshot_url text,
  linkedin_url text,
  linkedin_signal text CHECK (linkedin_signal = ANY (ARRAY[
    'yes', 'no', 'unclear'
  ])),
  status text DEFAULT 'pending' CHECK (status = ANY (ARRAY[
    'pending', 'approved', 'rejected', 'resubmit'
  ])),
  rejection_reason text,
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage verifications"
  ON public.verifications FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('chapter_admin', 'super_admin')
    )
  );

CREATE POLICY "Members can view own verification"
  ON public.verifications FOR SELECT
  USING (auth.uid() = member_id);

CREATE POLICY "Members can submit verification"
  ON public.verifications FOR INSERT
  WITH CHECK (auth.uid() = member_id);

CREATE INDEX IF NOT EXISTS verifications_member_idx
  ON public.verifications (member_id);

CREATE INDEX IF NOT EXISTS verifications_status_pending_idx
  ON public.verifications (status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS verifications_tenant_idx
  ON public.verifications (tenant_id);

-- 2. Endorsements
CREATE TABLE IF NOT EXISTS public.endorsements (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  from_member_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  tenant_id text NOT NULL DEFAULT 'eo',
  text text CHECK (char_length(text) <= 200),
  created_at timestamptz DEFAULT now(),
  UNIQUE(from_member_id, business_id)
);

ALTER TABLE public.endorsements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Endorsements visible to all members"
  ON public.endorsements FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Members can endorse other businesses"
  ON public.endorsements FOR INSERT
  WITH CHECK (
    auth.uid() = from_member_id
    AND NOT EXISTS (
      SELECT 1 FROM public.businesses
      WHERE id = business_id AND owner_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS endorsements_business_idx
  ON public.endorsements (business_id);

-- 3. Feature flags
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  flag_name text UNIQUE NOT NULL,
  is_enabled boolean DEFAULT false,
  enabled_at_listing_count integer,
  description text,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.feature_flags
  (flag_name, is_enabled, enabled_at_listing_count, description)
VALUES
  ('paid_member_tier',  false, 2500, 'Paid member tier — offers boosts deals'),
  ('member_offers',     false, 2500, 'Offer deal attachment on services'),
  ('boost_listings',    false, 2500, 'Paid ranking boost within verification tier'),
  ('spotlight_paid',    false, 2500, 'Paid spotlight placement on homepage'),
  ('featured_listings', false, 2500, 'Featured listing promote plan')
ON CONFLICT (flag_name) DO NOTHING;

-- 4. Events log
CREATE TABLE IF NOT EXISTS public.events_log (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  type text NOT NULL,
  member_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  entity_id uuid,
  metadata jsonb DEFAULT '{}',
  tenant_id text NOT NULL DEFAULT 'eo',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.events_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read events log"
  ON public.events_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('chapter_admin', 'super_admin')
    )
  );

CREATE INDEX IF NOT EXISTS events_log_type_idx
  ON public.events_log (type);

CREATE INDEX IF NOT EXISTS events_log_member_idx
  ON public.events_log (member_id);

CREATE INDEX IF NOT EXISTS events_log_tenant_idx
  ON public.events_log (tenant_id);

-- 5. Chapter managers
CREATE TABLE IF NOT EXISTS public.chapter_managers (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  chapter_id bigint REFERENCES public.eo_chapters(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id text NOT NULL DEFAULT 'eo',
  created_at timestamptz DEFAULT now(),
  UNIQUE(chapter_id, member_id)
);

ALTER TABLE public.chapter_managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage chapter managers"
  ON public.chapter_managers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('chapter_admin', 'super_admin')
    )
  );

-- 6. Spotlight schedule
CREATE TABLE IF NOT EXISTS public.spotlight_schedule (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  tenant_id text NOT NULL DEFAULT 'eo',
  month date NOT NULL,
  type text CHECK (type = ANY (ARRAY['paid', 'rotated'])),
  approved_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.spotlight_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage spotlight"
  ON public.spotlight_schedule FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('chapter_admin', 'super_admin')
    )
  );