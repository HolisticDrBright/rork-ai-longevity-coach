-- ============================================================
-- AI Longevity Pro - Storage Buckets
-- Creates Supabase Storage buckets for file uploads
-- Run AFTER 005_audit_logs.sql
-- ============================================================

-- Lab documents bucket (private — requires auth for access)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clinic-lab-documents',
  'clinic-lab-documents',
  false,
  10485760,  -- 10MB max file size
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for the lab documents bucket

-- Clinicians can upload files for their patients
CREATE POLICY "Clinicians upload lab documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'clinic-lab-documents'
    AND auth.uid() IS NOT NULL
  );

-- Clinicians can read their uploaded files
CREATE POLICY "Clinicians read lab documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'clinic-lab-documents'
    AND auth.uid() IS NOT NULL
  );

-- Clinicians can delete their uploaded files
CREATE POLICY "Clinicians delete lab documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'clinic-lab-documents'
    AND auth.uid() IS NOT NULL
  );
