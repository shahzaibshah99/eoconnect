-- ============================================================
-- 033_bulletin_posts.sql
-- F04: Business Needs bulletin board + public reply threads.
--
-- Two tables:
--   bulletin_posts  — the need/ask posted by a member
--   post_responses  — public thread replies from verified members
--
-- board_type='business' is F04 (this build).
-- board_type='community' is F05 (next build) — same tables, different
-- filtering. The schema is identical so F05 costs nothing extra.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bulletin_posts (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  board_type text NOT NULL DEFAULT 'business'
    CHECK (board_type IN ('business', 'community')),
  title text NOT NULL CHECK (char_length(title) >= 10 AND char_length(title) <= 120),
  detail text CHECK (char_length(detail) <= 2000),
  category text NOT NULL,
  -- Tags extracted by AI at submit time — used for matching businesses.
  tags text[] NOT NULL DEFAULT '{}',
  geography_country text,
  geography_city text,
  required_by date NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'fulfilled', 'expired', 'archived')),
  response_count integer NOT NULL DEFAULT 0,
  -- AI review output: stored so the member can see why we tagged the post.
  ai_reviewed_at timestamptz,
  ai_feedback text,
  -- UUIDs of businesses notified at post time (for the receipt display).
  matched_business_ids uuid[] NOT NULL DEFAULT '{}',
  -- Sentinel timestamps for satisfaction-prompt idempotency (cron).
  satisfaction_prompted_at timestamptz,
  expiry_warned_at timestamptz,
  tenant_id text NOT NULL DEFAULT 'eo',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bulletin_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read open bulletin posts"
  ON public.bulletin_posts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Members create own posts"
  ON public.bulletin_posts FOR INSERT
  WITH CHECK (auth.uid() = member_id);

CREATE POLICY "Members update own posts"
  ON public.bulletin_posts FOR UPDATE
  USING (auth.uid() = member_id);

CREATE INDEX IF NOT EXISTS bulletin_posts_board_status_idx
  ON public.bulletin_posts (board_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS bulletin_posts_member_idx
  ON public.bulletin_posts (member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bulletin_posts_tags_idx
  ON public.bulletin_posts USING GIN (tags);

CREATE INDEX IF NOT EXISTS bulletin_posts_required_by_idx
  ON public.bulletin_posts (required_by)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS bulletin_posts_tenant_idx
  ON public.bulletin_posts (tenant_id);


-- Public reply thread on bulletin posts.
CREATE TABLE IF NOT EXISTS public.post_responses (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES public.bulletin_posts(id) ON DELETE CASCADE,
  responder_member_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 2000),
  tenant_id text NOT NULL DEFAULT 'eo',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.post_responses ENABLE ROW LEVEL SECURITY;

-- All verified members can read threads.
CREATE POLICY "Members read post responses"
  ON public.post_responses FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Verified members can reply. Sponsors cannot (enforced at action layer
-- via requireVerified(); RLS here is a belt-and-braces).
CREATE POLICY "Members create responses"
  ON public.post_responses FOR INSERT
  WITH CHECK (auth.uid() = responder_member_id);

CREATE INDEX IF NOT EXISTS post_responses_post_idx
  ON public.post_responses (post_id, created_at ASC);

CREATE INDEX IF NOT EXISTS post_responses_member_idx
  ON public.post_responses (responder_member_id);


-- Trigger: keep bulletin_posts.response_count in sync so the list
-- page can show counts without a COUNT(*) join on every row.
CREATE OR REPLACE FUNCTION public.sync_post_response_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.bulletin_posts
    SET response_count = response_count + 1
    WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.bulletin_posts
    SET response_count = GREATEST(0, response_count - 1)
    WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_post_response_count ON public.post_responses;
CREATE TRIGGER trg_sync_post_response_count
  AFTER INSERT OR DELETE ON public.post_responses
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_response_count();
