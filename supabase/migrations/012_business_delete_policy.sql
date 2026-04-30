-- ============================================================
-- 012_business_delete_policy.sql
-- DELETE RLS policy for businesses.
--
-- Without this, the user-scoped client used by member-side
-- deleteBusiness() silently no-ops under RLS — zero rows affected,
-- no error returned, listing remains in the DB. Member sees the
-- "success" toast, refreshes, and the listing is still there.
--
-- Mirrors the SELECT/UPDATE policy structure: owners can delete
-- their own listings; chapter_admin and super_admin can delete any.
-- (The admin-side action uses the service-role client and bypasses
-- RLS anyway, but we keep the admin clause here for completeness so
-- a future user-scoped admin delete still works without surprise.)
--
-- ON DELETE CASCADE rules on services / listing_analytics / reviews /
-- ad_campaigns run at the schema level and don't go through RLS, so
-- no companion policies are needed there.
-- ============================================================

drop policy if exists "Owners and admins can delete business" on public.businesses;
create policy "Owners and admins can delete business"
  on public.businesses for delete
  using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.profiles
       where id = auth.uid()
         and role in ('chapter_admin', 'super_admin')
    )
  );
