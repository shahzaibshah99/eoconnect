-- Add 'archived' as a valid profile status.
-- Archived members are hidden from the default admin view but data is retained.
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('pending', 'active', 'suspended', 'archived'));
