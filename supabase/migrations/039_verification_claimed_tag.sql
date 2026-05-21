-- Members can now declare whether they are a current member or alumni
-- when submitting for verification. Stored as the tag they are claiming
-- so admin can pre-select it in the approval dialog.

ALTER TABLE public.verifications
  ADD COLUMN IF NOT EXISTS claimed_tag text
    CHECK (claimed_tag IN (
      'eo_member', 'eo_accelerator', 'eo_alumni', 'eo_sponsor',
      'ypo_member', 'ypo_alumni', 'ypo_sponsor'
    ));
