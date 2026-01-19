-- Create storage bucket for organization logos
-- Note: This requires the storage extension to be enabled in Supabase
-- Run this migration in your Supabase SQL editor

-- Create the 'logos' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logos',
  'logos',
  true, -- Make bucket public so logos can be accessed via URL
  5242880, -- 5MB file size limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Create a policy to allow authenticated users to upload files
CREATE POLICY "Allow authenticated users to upload logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'logos');

-- Create a policy to allow public read access to logos
CREATE POLICY "Allow public read access to logos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'logos');

-- Create a policy to allow authenticated users to update their own uploads
CREATE POLICY "Allow authenticated users to update logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'logos');

-- Create a policy to allow authenticated users to delete logos
CREATE POLICY "Allow authenticated users to delete logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'logos');
