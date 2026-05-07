-- ============================================================
-- 023_slow_replier_functions.sql
-- Functions for slow replier automation and nudge emails.
-- Called by a cron job or manually from admin panel.
-- ============================================================

-- Mark slow repliers at 90 days no login
CREATE OR REPLACE FUNCTION public.mark_slow_repliers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.businesses b
  SET slow_replier = true
  FROM public.profiles p
  WHERE b.owner_id = p.id
    AND p.last_login_at < NOW() - INTERVAL '90 days'
    AND b.slow_replier = false
    AND b.status = 'published';

  INSERT INTO public.events_log (type, metadata, tenant_id)
  VALUES (
    'slow_replier_batch',
    jsonb_build_object('run_at', now()),
    'eo'
  );
END;
$$;

-- Get members who need nudge emails at day 60 or day 85
CREATE OR REPLACE FUNCTION public.get_nudge_candidates()
RETURNS TABLE (
  profile_id uuid,
  email text,
  full_name text,
  days_inactive integer,
  nudge_type text,
  tenant_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.eo_membership_email,
    p.full_name,
    EXTRACT(DAY FROM NOW() - p.last_login_at)::integer,
    CASE
      WHEN EXTRACT(DAY FROM NOW() - p.last_login_at) BETWEEN 60 AND 61
        THEN 'nudge_60'
      WHEN EXTRACT(DAY FROM NOW() - p.last_login_at) BETWEEN 85 AND 86
        THEN 'nudge_85'
    END,
    p.tenant_id
  FROM public.profiles p
  WHERE p.last_login_at IS NOT NULL
    AND EXTRACT(DAY FROM NOW() - p.last_login_at)
        BETWEEN 60 AND 86
    AND p.status = 'active';
$$;

GRANT EXECUTE ON FUNCTION public.mark_slow_repliers TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_nudge_candidates TO authenticated;