-- 1. Create the bucket (Safe insert)
INSERT INTO storage.buckets (id, name, public)
VALUES ('looks', 'looks', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Create Policies (We removed the ALTER TABLE command that caused the error)

-- Drop existing policies if any to avoid conflicts
DROP POLICY IF EXISTS "Public Access Looks" ON storage.objects;
DROP POLICY IF EXISTS "Admin Upload Looks" ON storage.objects;
DROP POLICY IF EXISTS "Admin Manage Looks" ON storage.objects;
DROP POLICY IF EXISTS "Admin Delete Looks" ON storage.objects;

-- Re-create them
CREATE POLICY "Public Access Looks"
ON storage.objects FOR SELECT
USING ( bucket_id = 'looks' );

CREATE POLICY "Admin Upload Looks"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'looks' AND auth.role() = 'authenticated' );

CREATE POLICY "Admin Manage Looks"
ON storage.objects FOR UPDATE
USING ( bucket_id = 'looks' AND auth.role() = 'authenticated' );

CREATE POLICY "Admin Delete Looks"
ON storage.objects FOR DELETE
USING ( bucket_id = 'looks' AND auth.role() = 'authenticated' );
