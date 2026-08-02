-- Business contact details for self-serve organizations — an admin approving a pending org
-- (checkout_status='pending') had no way to see who's asking or reach them. contact_email is
-- required at the application layer for self-serve signup (OrganizationsService.createSelfServe);
-- website_url ("where will you use checkout") is optional context for the approval review.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS website_url TEXT;
