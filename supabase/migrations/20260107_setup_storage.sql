-- Create the storage bucket 'looks' if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('looks', 'looks', true)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on objects (it usually is by default, but good to ensure)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 1. Public Read Access (Images need to be seen by customers)
CREATE POLICY "Public Access Looks"
ON storage.objects FOR SELECT
USING ( bucket_id = 'looks' );

-- 2. Authenticated Upload (Admins)
CREATE POLICY "Admin Upload Looks"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'looks' AND auth.role() = 'authenticated' );

-- 3. Authenticated Update/Delete (Admins)
CREATE POLICY "Admin Manage Looks"
ON storage.objects FOR UPDATE
USING ( bucket_id = 'looks' AND auth.role() = 'authenticated' );

CREATE POLICY "Admin Delete Looks"
ON storage.objects FOR DELETE
USING ( bucket_id = 'looks' AND auth.role() = 'authenticated' );
