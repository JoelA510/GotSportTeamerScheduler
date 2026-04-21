-- Wave 2 Task 2 (Audit F-2-02): privatize the raw-imports bucket and replace
-- the over-permissive SELECT policy with org-member scoping by path prefix.
--
-- Background: 20251208000000_consolidated_schema.sql created `raw-imports` with
-- public=true and a "Public Access" SELECT policy gated only on bucket_id. Any
-- unauthenticated client could enumerate and download every uploaded CSV across
-- every tenant.
--
-- Convention: when frontend / Edge Functions later upload to this bucket, the
-- path MUST start with `<organization_id>/...`. The new SELECT/INSERT policies
-- enforce that the caller belongs to the org named by the leading path segment.
--
-- Current state: zero frontend / Edge Function consumers (verified by `grep
-- raw-imports` returning empty in src + supabase/functions). This migration is
-- safe to apply without breaking active code paths.
--
-- Reversal: see docs/sql/reverts/20260421001043_revert.sql.

-- 1. Flip the bucket to private.
update storage.buckets set public = false where id = 'raw-imports';

-- 2. Replace the over-permissive SELECT policy.
drop policy if exists "Public Access" on storage.objects;

create policy "raw-imports org-member select"
  on storage.objects for select
  using (
    bucket_id = 'raw-imports'
    and (
      -- The first path segment is the organization_id; verify membership.
      (storage.foldername(name))[1]::uuid in (
        select organization_id
        from public.organization_members
        where profile_id = auth.uid()
      )
    )
  );

-- 3. Tighten the INSERT policy with the same path-prefix discipline.
drop policy if exists "Authenticated Upload" on storage.objects;

create policy "raw-imports org-member insert"
  on storage.objects for insert
  with check (
    bucket_id = 'raw-imports'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1]::uuid in (
      select organization_id
      from public.organization_members
      where profile_id = auth.uid()
    )
  );

-- 4. Allow org-members to delete their own org's objects (e.g. retention cron in Wave 6b).
create policy "raw-imports org-member delete"
  on storage.objects for delete
  using (
    bucket_id = 'raw-imports'
    and (storage.foldername(name))[1]::uuid in (
      select organization_id
      from public.organization_members
      where profile_id = auth.uid()
    )
  );
