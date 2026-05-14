-- Add removal_token to businesses for one-click listing removal from claim emails.
-- A member who doesn't want to be listed can click {{remove_url}} in their invite
-- email and the listing is archived without them ever needing to sign up.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS removal_token text UNIQUE;
